"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildStudioAskPayload,
  studioTurnsToMemoryTurns
} from "../../lib/studioAgentAsk";
import {
  buildPostDoneFollowUpRoute,
  STUDIO_POST_DONE_AUTHOR_EXTRA,
  STUDIO_POST_DONE_INTERNAL_QUESTION
} from "../../lib/studioPostDoneFollowUp";
import { routeStudioAction, type StudioRouteDecision } from "../../lib/studioOrchestrator";
import { formatStudioAskError } from "../../lib/studioAskError";
import { featureCoreToPrompt } from "../../lib/homeComposerFeatureCore";
import { personalProfileToPrompt } from "../../lib/homeComposerProfile";
import {
  getComposerPrefsFeatureCore,
  getStudioComposerPrefs,
  getStudioWork
} from "../../lib/studioWorkStorage";
import { syncWorkTitleFromTurns } from "../../lib/studioWorkTask";
import { markOpenComposerFeature } from "../../lib/studioComposerFeatureLink";
import { WORKBENCH_CHAT_PATH } from "../../lib/navPaths";
import { streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import type { ManuscriptVersion, StudioAgentTurn, StudioWork, WorkStatus } from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioAgentMessage from "./StudioAgentMessage";
import StudioAgentOutputCards from "./StudioAgentOutputCards";
import StudioCorpusBar from "./StudioCorpusBar";

const QUICK_PROMPTS = [
  "我想写一篇清单体内容，受众是产品新人",
  "帮我理清这篇要写什么、结构怎么搭",
  "开头钩子怎么写更抓人"
] as const;

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "生成中…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  if (status === "planned") return "正在根据计划写稿…";
  return "描述你想创作的内容与目标…";
}

function workAfterTruncateTurns(work: StudioWork, prefixTurns: StudioAgentTurn[]): StudioWork {
  let next: StudioWork = {
    ...work,
    agentTurns: prefixTurns,
    error: undefined,
    pendingPatch: undefined
  };
  if (prefixTurns.length === 0) {
    next = { ...next, plan: undefined, status: "briefing" };
  } else if (work.status === "planned" || work.status === "briefing") {
    next = { ...next, plan: undefined, status: "briefing" };
  }
  return syncWorkTitleFromTurns(next, prefixTurns);
}

export default function StudioAgentDock({
  work,
  isLoggedIn,
  ready,
  parentBusy,
  getAuthHeaders,
  onPersist,
  onGeneratePlan,
  onConfirmGenerate,
  onReviseFromChat,
  activeVersion,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  showFeatureNudge,
  onDismissFeatureNudge
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  parentBusy: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  onGeneratePlan?: () => void | Promise<void>;
  onConfirmGenerate?: () => void | Promise<void>;
  onReviseFromChat?: (opinion: string) => void | Promise<void>;
  activeVersion: ManuscriptVersion | null;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  showFeatureNudge: boolean;
  onDismissFeatureNudge: () => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [corpusMenuOpen, setCorpusMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const postDoneStartedRef = useRef(false);

  const turns = work.agentTurns ?? [];
  const readOnly = work.status === "generating" || parentBusy;
  const canChat = isLoggedIn && ready && !readOnly;
  const showQuickPrompts = turns.length === 0 && work.status === "briefing";
  const canEditTurns = canChat && !agentBusy;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [
    turns.length,
    turns[turns.length - 1]?.content,
    work.plan,
    work.status,
    work.runPhase,
    work.error,
    work.pendingPatch,
    activeVersion?.id,
    activeVersion?.blocks.length,
    work.postDoneCoach,
    work.postDoneCoachStreaming
  ]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    postDoneStartedRef.current = false;
  }, [work.id]);

  useEffect(() => {
    if (!corpusMenuOpen) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (target instanceof Element && target.closest("[data-composer-dropdown]")) return;
      if (target instanceof Element && target.closest("[data-studio-corpus-anchor]")) return;
      setCorpusMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [corpusMenuOpen]);

  useEffect(() => {
    if (!work.postDoneFollowUpPending || work.postDoneFollowUpDone) return;
    if (!canChat || agentBusy || parentBusy) return;
    if (postDoneStartedRef.current) return;
    postDoneStartedRef.current = true;
    onPersist({
      ...work,
      postDoneFollowUpPending: false,
      postDoneFollowUpDone: true,
      postDoneCoach: "",
      postDoneCoachStreaming: true,
      lastOrchestratorNote: undefined
    });
    void runPostDoneCoach(work);
  }, [work.id, work.postDoneFollowUpPending, work.postDoneFollowUpDone, canChat, agentBusy, parentBusy]);

  function applyDialogExtract(
    nextTurns: StudioAgentTurn[],
    sessionState: typeof work.agentSessionState = work.agentSessionState ?? null
  ) {
    let next: StudioWork = {
      ...work,
      agentTurns: nextTurns,
      agentSessionState: sessionState ?? null,
      allowModelFallback: true
    };
    onPersist(syncWorkTitleFromTurns(next, nextTurns));
  }

  function patchTurnsStreaming(nextTurns: StudioAgentTurn[]) {
    onPersist({ ...work, agentTurns: nextTurns });
  }

  async function runAgentTurn(
    prefixTurns: StudioAgentTurn[],
    userText: string,
    workBase: StudioWork,
    route: StudioRouteDecision,
    options?: { authorIpExtra?: string }
  ) {
    const q = userText.trim();
    if (!q || agentBusy) return;
    if (!options?.authorIpExtra && !canChat) return;

    const intent = route.intent;

    const assistantId = crypto.randomUUID();
    const streamingTurn: StudioAgentTurn = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true,
      intent
    };
    const baseTurns = [...prefixTurns, streamingTurn];
    applyDialogExtract(baseTurns);
    setAgentBusy(true);
    setPhase("");

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const memoryFromStudio = studioTurnsToMemoryTurns(prefixTurns);
    const hasCorpus = Boolean(workBase.binding.notebook.trim() && workBase.binding.noteIds.length > 0);
    const ragMode = hasCorpus ? ("rag" as const) : ("general" as const);

    const prefs = getStudioComposerPrefs();
    const corePrompt = featureCoreToPrompt(getComposerPrefsFeatureCore());
    const profilePrompt =
      prefs.personalEnabled && prefs.personalProfile
        ? personalProfileToPrompt(prefs.personalProfile)
        : "";
    const authorIpExtra = [corePrompt, profilePrompt, options?.authorIpExtra]
      .filter(Boolean)
      .join("\n\n");
    const askPayload = buildStudioAskPayload({
      work: workBase,
      userMessage: q,
      intent,
      activeVersion,
      authorIpExtra,
      askFlags: route.askContext,
      mode: ragMode
    });

    let answerBuf = "";
    let supplementBuf = "";

    try {
      const done = await streamHomeComposerAsk({
        question: askPayload.question,
        mode: ragMode,
        notebook: workBase.binding.notebook,
        noteIds: workBase.binding.noteIds,
        memoryTurns: memoryFromStudio,
        sessionState: workBase.agentSessionState ?? null,
        dialogueStylePrompt: askPayload.dialogueStylePrompt,
        authorIpPrompt: askPayload.authorIpPrompt,
        authHeaders: getAuthHeaders(),
        signal: ac.signal,
        callbacks: {
          onPhase: (msg) => setPhase(msg),
          onChunk: (text, role, section) => {
            if (role === "reasoning") return;
            if (section === "supplement") supplementBuf += text;
            else answerBuf += text;
            const content = answerBuf.trim() || supplementBuf.trim();
            patchTurnsStreaming(
              baseTurns.map((t) =>
                t.id === assistantId ? { ...t, content, streaming: true, intent } : t
              )
            );
          }
        }
      });

      const finalContent =
        done.answer.trim() ||
        supplementBuf.trim() ||
        answerBuf.trim() ||
        "（暂无回复）";

      const finalTurns = baseTurns.map((t) =>
        t.id === assistantId
          ? { ...t, content: finalContent, streaming: false, intent }
          : t
      );
      applyDialogExtract(finalTurns, done.sessionState);
      onPersist({ ...workBase, agentTurns: finalTurns, error: undefined });
    } catch (err) {
      if (ac.signal.aborted) return;
      const friendly = formatStudioAskError(String(err instanceof Error ? err.message : err));
      onPersist({
        ...workBase,
        agentTurns: baseTurns.filter((t) => t.id !== assistantId),
        error: friendly
      });
    } finally {
      setAgentBusy(false);
      setPhase("");
      abortRef.current = null;
    }
  }

  async function runPostDoneCoach(workBase: StudioWork) {
    const route = buildPostDoneFollowUpRoute();
    const q = STUDIO_POST_DONE_INTERNAL_QUESTION;
    setAgentBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const hasCorpus = Boolean(workBase.binding.notebook.trim() && workBase.binding.noteIds.length > 0);
    const ragMode = hasCorpus ? ("rag" as const) : ("general" as const);
    const prefs = getStudioComposerPrefs();
    const corePrompt = featureCoreToPrompt(getComposerPrefsFeatureCore());
    const profilePrompt =
      prefs.personalEnabled && prefs.personalProfile
        ? personalProfileToPrompt(prefs.personalProfile)
        : "";
    const authorIpExtra = [corePrompt, profilePrompt, STUDIO_POST_DONE_AUTHOR_EXTRA]
      .filter(Boolean)
      .join("\n\n");
    const askPayload = buildStudioAskPayload({
      work: workBase,
      userMessage: q,
      intent: route.intent,
      activeVersion,
      authorIpExtra,
      askFlags: route.askContext,
      mode: ragMode
    });

    let answerBuf = "";
    let supplementBuf = "";

    try {
      const done = await streamHomeComposerAsk({
        question: askPayload.question,
        mode: ragMode,
        notebook: workBase.binding.notebook,
        noteIds: workBase.binding.noteIds,
        memoryTurns: studioTurnsToMemoryTurns(workBase.agentTurns ?? []),
        sessionState: workBase.agentSessionState ?? null,
        dialogueStylePrompt: askPayload.dialogueStylePrompt,
        authorIpPrompt: askPayload.authorIpPrompt,
        authHeaders: getAuthHeaders(),
        signal: ac.signal,
        callbacks: {
          onChunk: (text, role, section) => {
            if (role === "reasoning") return;
            if (section === "supplement") supplementBuf += text;
            else answerBuf += text;
            const content = answerBuf.trim() || supplementBuf.trim();
            const cur = getStudioWork(work.id) ?? workBase;
            onPersist({
              ...cur,
              postDoneCoach: content,
              postDoneCoachStreaming: true
            });
          }
        }
      });

      const finalContent =
        done.answer.trim() ||
        supplementBuf.trim() ||
        answerBuf.trim() ||
        "";
      const cur = getStudioWork(work.id) ?? workBase;
      onPersist({
        ...cur,
        postDoneCoach: finalContent,
        postDoneCoachStreaming: false,
        agentSessionState: done.sessionState ?? cur.agentSessionState ?? null
      });
    } catch {
      const cur = getStudioWork(work.id) ?? workBase;
      onPersist({
        ...cur,
        postDoneCoachStreaming: false
      });
    } finally {
      setAgentBusy(false);
      abortRef.current = null;
    }
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat || agentBusy) return;
    setInput("");

    const route = routeStudioAction(work, q, turns);
    const userTurn: StudioAgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: Date.now()
    };
    const prefixWithUser = [...turns, userTurn];
    const base = syncWorkTitleFromTurns(
      {
        ...work,
        agentTurns: prefixWithUser,
        lastOrchestratorNote: route.note,
        error: undefined,
        allowModelFallback: true
      },
      prefixWithUser
    );
    onPersist(base);

    if (route.tool === "plan" && onGeneratePlan) {
      await onGeneratePlan();
      return;
    }
    if (route.tool === "generate" && onConfirmGenerate) {
      await onConfirmGenerate();
      return;
    }
    if (route.tool === "revise" && onReviseFromChat) {
      const userTurnAlready = prefixWithUser;
      onPersist({ ...base, agentTurns: userTurnAlready });
      await onReviseFromChat(q);
      return;
    }

    await runAgentTurn(prefixWithUser, q, base, route);
  }

  function handleEditUserTurn(turnId: string, newText: string) {
    abortRef.current?.abort();
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0 || turns[idx]?.role !== "user") return;
    const prefix = turns.slice(0, idx);
    const truncated = workAfterTruncateTurns(work, prefix);
    onPersist(truncated);
    const route = routeStudioAction(truncated, newText, prefix);
    const userTurn: StudioAgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: newText.trim(),
      createdAt: Date.now()
    };
    const prefixWithUser = [...prefix, userTurn];
    const base = syncWorkTitleFromTurns(
      { ...truncated, agentTurns: prefixWithUser, lastOrchestratorNote: route.note },
      prefixWithUser
    );
    onPersist(base);
    if (route.tool === "plan" && onGeneratePlan) {
      void onGeneratePlan();
      return;
    }
    if (route.tool === "generate" && onConfirmGenerate) {
      void onConfirmGenerate();
      return;
    }
    if (route.tool === "revise" && onReviseFromChat) {
      void onReviseFromChat(newText.trim());
      return;
    }
    void runAgentTurn(prefixWithUser, newText, base, route);
  }

  function handleRollbackFromTurn(turnId: string) {
    abortRef.current?.abort();
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    const prefix = turns.slice(0, idx);
    onPersist(workAfterTruncateTurns(work, prefix));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div ref={scrollRef} className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto px-3 py-3">
        {turns.length > 0 ? (
          <div className="mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">对话 · 解释</p>
            <div className="mt-2 space-y-3">
              {turns.map((turn) => (
                <StudioAgentMessage
                  key={turn.id}
                  turn={turn}
                  streamingPhase={turn.streaming ? phase : undefined}
                  canEdit={canEditTurns}
                  onEditUserTurn={handleEditUserTurn}
                  onRollbackFromTurn={handleRollbackFromTurn}
                />
              ))}
            </div>
          </div>
        ) : null}

        <StudioAgentOutputCards
          work={work}
          busy={agentBusy || parentBusy}
          activeVersion={activeVersion}
          onApplyPatch={onApplyPatch}
          onDiscardPatch={onDiscardPatch}
          selectedPatchKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onTogglePatchKey={onTogglePatchKey}
          showFeatureNudge={showFeatureNudge}
          onFillFeature={() => {
            markOpenComposerFeature();
            router.push(WORKBENCH_CHAT_PATH);
          }}
          onDismissFeatureNudge={onDismissFeatureNudge}
        />
      </div>

      <div className="shrink-0 bg-surface px-3 pb-3 pt-1">
        <div className="mx-auto w-full max-w-3xl">
          {!isLoggedIn && ready ? (
            <p className="mb-2 text-xs text-warning-ink">
              <Link href="/login" className="text-brand underline">
                登录
              </Link>
              后可用
            </p>
          ) : null}
          {showQuickPrompts ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!canChat}
                  className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                  onClick={() => void handleSend(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
          <StudioAgentComposer
            value={input}
            onChange={setInput}
            onSend={() => void handleSend()}
            busy={agentBusy}
            disabled={!canChat}
            placeholder={agentPlaceholder(work.status)}
            menuOpen={corpusMenuOpen}
            footerRight={
              <StudioCorpusBar
                work={work}
                isLoggedIn={isLoggedIn}
                ready={ready}
                getAuthHeaders={getAuthHeaders}
                onPersist={onPersist}
                menuOpen={corpusMenuOpen}
                onMenuOpenChange={setCorpusMenuOpen}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
