"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildStudioAskPayload,
  studioTurnsToMemoryTurns
} from "../../lib/studioAgentAsk";
import {
  buildPostDoneFollowUpRoute,
  STUDIO_POST_DONE_AUTHOR_EXTRA,
  STUDIO_POST_DONE_COACH_ENABLED,
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
import { firstUserSentenceFromTurns, syncWorkTitleFromTurns } from "../../lib/studioWorkTask";
import { suggestStudioWorkTitleLlm } from "../../lib/studioWorkTitleSuggest";
import {
  resetStudioRagWarmOnBindingChange,
  softenStudioRagPhaseMessage,
  studioCorpusBindingKey
} from "../../lib/studioAskPhase";
import { buildStudioDialogueTurnGroups } from "../../lib/studioDialogueTurnGroups";
import { markOpenComposerFeature } from "../../lib/studioComposerFeatureLink";
import { WORKBENCH_CHAT_PATH } from "../../lib/navPaths";
import { streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import { streamStudioAgentAsk } from "../../lib/studioAgentAskStream";
import {
  STUDIO_STRUCTURED_OUTPUT_ENABLED,
  studioStructuredAddsAssistantTurn
} from "../../lib/studioAgentStructured";
import type { ManuscriptVersion, StudioAgentTurn, StudioWork, WorkStatus } from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioAgentOutputCards from "./StudioAgentOutputCards";
import StudioDialoguePanel from "./StudioDialoguePanel";
import StudioCorpusBar from "./StudioCorpusBar";
import StudioEphemeralHint from "./StudioEphemeralHint";

const QUICK_PROMPTS = [
  "我想写一篇清单体内容，受众是产品新人",
  "帮我理清这篇要写什么、结构怎么搭",
  "开头钩子怎么写更抓人"
] as const;

function studioDockHasArtifact(work: StudioWork, activeVersion: ManuscriptVersion | null): boolean {
  if (work.error) return true;
  const compareMode = Boolean(work.pendingPatch);
  const blocks =
    compareMode && work.pendingPatch
      ? work.pendingPatch.proposedBlocks
      : activeVersion?.blocks ?? [];
  if (
    blocks.length > 0 &&
    (work.status === "ready" || work.status === "shipped" || compareMode)
  ) {
    return true;
  }
  if (work.pendingPatch) return true;
  if (
    STUDIO_POST_DONE_COACH_ENABLED &&
    Boolean(work.postDoneCoach?.trim() || work.postDoneCoachStreaming)
  ) {
    return true;
  }
  return false;
}

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "生成中…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  if (status === "planned") return "正在根据计划写稿…";
  return "描述你想创作的内容与目标…";
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
  const agentBusyRef = useRef(false);
  const [phase, setPhase] = useState("");
  const [corpusMenuOpen, setCorpusMenuOpen] = useState(false);
  const [ephemeralHint, setEphemeralHint] = useState("");
  const dialogueScrollRef = useRef<HTMLDivElement>(null);
  const artifactScrollRef = useRef<HTMLDivElement>(null);
  const lastUserAnchorIdRef = useRef<string | null>(null);
  const phaseRef = useRef("");
  const streamRafRef = useRef(0);
  const ragWarmBindingsRef = useRef(new Set<string>());
  const prevCorpusBindingRef = useRef<string | null>(null);
  const [streamOverlay, setStreamOverlay] = useState<StudioAgentTurn[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const postDoneStartedRef = useRef(false);
  const titleSuggestAbortRef = useRef<AbortController | null>(null);
  const titleSuggestKeyRef = useRef("");

  function setAgentBusyState(next: boolean) {
    agentBusyRef.current = next;
    setAgentBusy(next);
  }

  const turns = work.agentTurns ?? [];
  const dialogueTurns = streamOverlay ?? turns;
  const readOnly = work.status === "generating" || parentBusy;
  const canChat = isLoggedIn && ready && !readOnly;
  const showQuickPrompts = turns.length === 0 && work.status === "briefing";
  const hasArtifact = studioDockHasArtifact(work, activeVersion);

  const scrollToActiveUser = useCallback(() => {
    dialogueScrollRef.current
      ?.querySelector('[data-studio-user-anchor="active"]')
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const activeUserTurnId = useMemo(() => {
    const groups = buildStudioDialogueTurnGroups(turns);
    return groups[groups.length - 1]?.userTurn.id ?? null;
  }, [turns]);

  useEffect(() => {
    if (!activeUserTurnId || activeUserTurnId === lastUserAnchorIdRef.current) return;
    lastUserAnchorIdRef.current = activeUserTurnId;
    requestAnimationFrame(() => scrollToActiveUser());
  }, [activeUserTurnId, scrollToActiveUser]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    postDoneStartedRef.current = false;
    titleSuggestKeyRef.current = "";
    ragWarmBindingsRef.current.clear();
    prevCorpusBindingRef.current = null;
    setStreamOverlay(null);
  }, [work.id]);

  useEffect(() => {
    const key = studioCorpusBindingKey(work.binding.notebook, work.binding.noteIds);
    resetStudioRagWarmOnBindingChange(key, prevCorpusBindingRef, ragWarmBindingsRef.current);
  }, [work.binding.notebook, work.binding.noteIds]);

  useEffect(() => {
    if (!isLoggedIn || !ready) return;
    const first = firstUserSentenceFromTurns(turns);
    if (!first || first.length < 4) return;
    if (work.titleLlmSource === first) return;
    if (titleSuggestKeyRef.current === first) return;
    titleSuggestKeyRef.current = first;

    titleSuggestAbortRef.current?.abort();
    const ac = new AbortController();
    titleSuggestAbortRef.current = ac;

    void (async () => {
      try {
        const title = await suggestStudioWorkTitleLlm(first, getAuthHeaders(), ac.signal);
        if (ac.signal.aborted || !title) return;
        const cur = getStudioWork(work.id) ?? work;
        if (firstUserSentenceFromTurns(cur.agentTurns ?? []) !== first) return;
        onPersist({ ...cur, title, titleLlmSource: first });
      } catch {
        // 保留 fallback 标题
      } finally {
        if (titleSuggestAbortRef.current === ac) titleSuggestAbortRef.current = null;
      }
    })();
  }, [turns, work.id, work.titleLlmSource, isLoggedIn, ready, getAuthHeaders, onPersist, work]);

  useEffect(() => () => titleSuggestAbortRef.current?.abort(), []);

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
    if (!STUDIO_POST_DONE_COACH_ENABLED) return;
    if (!work.postDoneFollowUpPending || work.postDoneFollowUpDone) return;
    if (!canChat || parentBusy) return;
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
  }, [work.id, work.postDoneFollowUpPending, work.postDoneFollowUpDone, canChat, parentBusy]);

  function applyDialogExtract(
    nextTurns: StudioAgentTurn[],
    sessionState: typeof work.agentSessionState = work.agentSessionState ?? null,
    workBase: StudioWork = work
  ) {
    let next: StudioWork = {
      ...workBase,
      agentTurns: nextTurns,
      agentSessionState: sessionState ?? null,
      allowModelFallback: true
    };
    onPersist(syncWorkTitleFromTurns(next, nextTurns));
  }

  function scheduleStreamOverlay(nextTurns: StudioAgentTurn[]) {
    setStreamOverlay(nextTurns);
  }

  function flushStreamOverlayFrame(
    assistantId: string,
    preview: string,
    baseTurns: StudioAgentTurn[],
    intent: StudioRouteDecision["intent"]
  ) {
    if (streamRafRef.current) return;
    streamRafRef.current = requestAnimationFrame(() => {
      streamRafRef.current = 0;
      scheduleStreamOverlay(
        baseTurns.map((t) =>
          t.id === assistantId ? { ...t, content: preview, streaming: true, intent } : t
        )
      );
    });
  }

  function handleAskPhase(msg: string, workBase: StudioWork) {
    const hasCorpus = Boolean(workBase.binding.notebook.trim() && workBase.binding.noteIds.length > 0);
    const bindingKey = studioCorpusBindingKey(workBase.binding.notebook, workBase.binding.noteIds);
    const softened =
      hasCorpus && workBase.binding.noteIds.length > 0
        ? softenStudioRagPhaseMessage(msg, bindingKey, ragWarmBindingsRef.current)
        : msg;
    phaseRef.current = softened;
    setPhase(softened);
  }

  async function runAgentTurn(
    prefixTurns: StudioAgentTurn[],
    userText: string,
    workBase: StudioWork,
    route: StudioRouteDecision,
    options?: { authorIpExtra?: string }
  ) {
    const q = userText.trim();
    if (!q || agentBusyRef.current) return;
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
    scheduleStreamOverlay(baseTurns);
    setAgentBusyState(true);
    phaseRef.current = "";
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
      const done = await streamStudioAgentAsk({
        work: workBase,
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
          onPhase: (msg) => handleAskPhase(msg, workBase),
          onChunk: (text, role, section) => {
            if (role === "reasoning") return;
            if (section === "supplement") supplementBuf += text;
            else answerBuf += text;
            const preview = STUDIO_STRUCTURED_OUTPUT_ENABLED
              ? phaseRef.current || "正在生成回答…"
              : answerBuf.trim() || supplementBuf.trim();
            flushStreamOverlayFrame(assistantId, preview, baseTurns, intent);
          }
        }
      });

      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }

      if (
        STUDIO_STRUCTURED_OUTPUT_ENABLED &&
        !studioStructuredAddsAssistantTurn(done.structured)
      ) {
        setStreamOverlay(null);
        applyDialogExtract(prefixTurns, done.sessionState, workBase);
        onPersist({ ...workBase, agentTurns: prefixTurns, error: undefined });
        return;
      }

      const finalContent =
        done.displayText.trim() ||
        done.answer.trim() ||
        supplementBuf.trim() ||
        answerBuf.trim() ||
        "（暂无回复）";

      const finalTurns = baseTurns.map((t) =>
        t.id === assistantId
          ? {
              ...t,
              content: finalContent,
              streaming: false,
              intent,
              askSources: done.sources?.length ? done.sources : undefined
            }
          : t
      );
      setStreamOverlay(null);
      applyDialogExtract(finalTurns, done.sessionState, workBase);
      onPersist({ ...workBase, agentTurns: finalTurns, error: undefined });
    } catch (err) {
      if (ac.signal.aborted) return;
      setStreamOverlay(null);
      const friendly = formatStudioAskError(String(err instanceof Error ? err.message : err));
      onPersist({
        ...workBase,
        agentTurns: prefixTurns,
        error: friendly
      });
    } finally {
      setAgentBusyState(false);
      phaseRef.current = "";
      setPhase("");
      abortRef.current = null;
    }
  }

  async function runPostDoneCoach(workBase: StudioWork) {
    const route = buildPostDoneFollowUpRoute();
    const q = STUDIO_POST_DONE_INTERNAL_QUESTION;
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
      abortRef.current = null;
    }
  }

  function abortBackgroundStreams() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (streamRafRef.current) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = 0;
    }
    setStreamOverlay(null);
    setAgentBusyState(false);
    phaseRef.current = "";
    setPhase("");
    if (work.postDoneCoachStreaming) {
      onPersist({ ...work, postDoneCoachStreaming: false });
    }
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat) return;
    abortBackgroundStreams();
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

    if (route.tool === "plan") {
      setEphemeralHint("已确认范围，正在整理并写稿…");
    } else if (route.tool === "revise") {
      setEphemeralHint("正在按你的意见改版…");
    }

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-3 py-3">
        {dialogueTurns.length > 0 || work.status === "generating" ? (
          <div
            className={
              hasArtifact
                ? "mb-2 flex min-h-[120px] max-h-[min(42vh,360px)] shrink-0 flex-col"
                : "mb-2 flex min-h-0 flex-1 flex-col"
            }
          >
            <StudioDialoguePanel
              turns={dialogueTurns}
              streamingPhase={phase}
              statusLine={
                work.status === "generating" ? work.runPhase || "处理中…" : undefined
              }
              scrollRef={dialogueScrollRef}
            />
          </div>
        ) : null}

        <div
          ref={artifactScrollRef}
          className={
            hasArtifact
              ? "min-h-0 flex-1 overflow-y-auto overscroll-contain"
              : "shrink-0"
          }
        >
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
          {ephemeralHint ? (
            <div className="mb-2">
              <StudioEphemeralHint text={ephemeralHint} />
            </div>
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
