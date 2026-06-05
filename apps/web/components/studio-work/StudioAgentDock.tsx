"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildStudioAskPayload,
  studioTurnsToMemoryTurns
} from "../../lib/studioAgentAsk";
import { shouldShowStudioManuscriptSection } from "../../lib/studioDockLayout";
import { isDraftLikeStatus } from "../../lib/studioWorkMigrate";
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
import { streamStudioAgentAsk } from "../../lib/studioAgentAskStream";
import {
  STUDIO_STRUCTURED_OUTPUT_ENABLED,
  draftAskFallbackText,
  resolveStudioStructuredResponse,
  studioStructuredAddsAssistantTurn
} from "../../lib/studioAgentStructured";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  StudioAgentTurn,
  StudioWork,
  WorkStatus
} from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioDraftCanvas from "./StudioDraftCanvas";
import StudioDialoguePanel from "./StudioDialoguePanel";
import StudioCorpusBar from "./StudioCorpusBar";
import StudioEphemeralHint from "./StudioEphemeralHint";

const QUICK_PROMPTS = [
  "我想写一篇清单体内容，受众是产品新人",
  "帮我理清这篇要写什么、结构怎么搭",
  "开头钩子怎么写更抓人"
] as const;

function workAfterTruncateTurns(work: StudioWork, prefixTurns: StudioAgentTurn[]): StudioWork {
  let next: StudioWork = {
    ...work,
    agentTurns: prefixTurns,
    error: undefined,
    pendingPatch: undefined,
    plan: undefined
  };
  if (prefixTurns.length === 0 || isDraftLikeStatus(work.status)) {
    next = { ...next, status: "draft" };
  }
  return syncWorkTitleFromTurns(next, prefixTurns);
}

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "写稿进行中，仍可提问或描述下一步改版…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  return "描述你想创作的内容与目标…";
}

function appendToolAckTurn(
  turns: StudioAgentTurn[],
  tool: "generate" | "revise"
): StudioAgentTurn[] {
  const content = tool === "generate" ? "收到，开始写稿…" : "收到，按你的意见改版…";
  return [
    ...turns,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      createdAt: Date.now()
    }
  ];
}

export default function StudioAgentDock({
  work,
  isLoggedIn,
  ready,
  jobBusy,
  getAuthHeaders,
  onPersist,
  onGenerate,
  onReviseFromChat,
  onQueueRevise,
  activeVersion,
  versions = [],
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  showFeatureNudge,
  onDismissFeatureNudge,
  onTitleIndexChange,
  onVersionChange,
  onBlocksChange,
  onSelectionRevise,
  onWowRevise
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  jobBusy: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  onGenerate?: () => void | Promise<void>;
  onReviseFromChat?: (opinion: string) => void | Promise<void>;
  onQueueRevise?: (opinion: string) => void;
  activeVersion: ManuscriptVersion | null;
  versions?: ManuscriptVersion[];
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  showFeatureNudge: boolean;
  onDismissFeatureNudge: () => void;
  onTitleIndexChange?: (index: number) => void;
  onVersionChange?: (versionId: string) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
  onSelectionRevise?: (selectedText: string, opinion: string) => void;
  onWowRevise?: (opinion: string) => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const agentBusyRef = useRef(false);
  const [phase, setPhase] = useState("");
  const [corpusMenuOpen, setCorpusMenuOpen] = useState(false);
  const [ephemeralHint, setEphemeralHint] = useState("");
  const dialogueScrollRef = useRef<HTMLDivElement>(null);
  const lastUserAnchorIdRef = useRef<string | null>(null);
  const phaseRef = useRef("");
  const streamRafRef = useRef(0);
  const ragWarmBindingsRef = useRef(new Set<string>());
  const prevCorpusBindingRef = useRef<string | null>(null);
  const [streamOverlay, setStreamOverlay] = useState<StudioAgentTurn[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleSuggestAbortRef = useRef<AbortController | null>(null);
  const titleSuggestKeyRef = useRef("");

  function setAgentBusyState(next: boolean) {
    agentBusyRef.current = next;
    setAgentBusy(next);
  }

  const turns = work.agentTurns ?? [];
  const dialogueTurns = streamOverlay ?? turns;
  const jobRunning = work.status === "generating" || jobBusy;
  const canChat = isLoggedIn && ready;
  const showQuickPrompts = turns.length === 0 && isDraftLikeStatus(work.status) && !jobRunning;
  const canEditTurns = canChat && !agentBusy;
  const showManuscriptSection = shouldShowStudioManuscriptSection(work, activeVersion, {
    showFeatureNudge
  });
  const dialogueEmptyHint =
    turns.length === 0 && isDraftLikeStatus(work.status) && work.status !== "generating"
      ? "描述你想创作的内容，够信息后会自动开始写稿"
      : undefined;

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
    if (!options?.authorIpExtra && !isLoggedIn) return;

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
            if (STUDIO_STRUCTURED_OUTPUT_ENABLED) return;
            const preview = answerBuf.trim() || supplementBuf.trim();
            if (preview) flushStreamOverlayFrame(assistantId, preview, baseTurns, intent);
          }
        }
      });

      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }

      const resolvedStructured = resolveStudioStructuredResponse(workBase, done.structured, q);

      if (
        STUDIO_STRUCTURED_OUTPUT_ENABLED &&
        !studioStructuredAddsAssistantTurn(resolvedStructured)
      ) {
        const rawFallback =
          done.displayText.trim() ||
          done.answer.trim() ||
          supplementBuf.trim() ||
          answerBuf.trim();
        const clarify = draftAskFallbackText(workBase, q, rawFallback);
        if (clarify) {
          const finalTurns = baseTurns.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  content: clarify,
                  streaming: false,
                  intent,
                  askSources: done.sources?.length ? done.sources : undefined
                }
              : t
          );
          setStreamOverlay(null);
          applyDialogExtract(finalTurns, done.sessionState, workBase);
          onPersist({ ...workBase, agentTurns: finalTurns, error: undefined });
          return;
        }
        setStreamOverlay(null);
        applyDialogExtract(prefixTurns, done.sessionState, workBase);
        onPersist({ ...workBase, agentTurns: prefixTurns, error: undefined });
        return;
      }

      const finalContent =
        (resolvedStructured.kind === "reply"
          ? resolvedStructured.text
          : resolvedStructured.kind === "ask_user"
            ? resolvedStructured.question
            : "") ||
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
  }

  async function dispatchRoutedSend(
    prefixWithUser: StudioAgentTurn[],
    q: string,
    route: StudioRouteDecision,
    base: StudioWork
  ) {
    if (jobRunning && route.tool === "generate") {
      setEphemeralHint("当前写稿/改版进行中，请稍候…");
      return;
    }
    if (jobRunning && route.tool === "revise") {
      onQueueRevise?.(q);
      setEphemeralHint("已加入改版队列，当前任务完成后执行");
      onPersist({ ...base, agentTurns: appendToolAckTurn(prefixWithUser, "revise") });
      return;
    }

    if (route.tool === "generate") {
      setEphemeralHint("正在写稿…");
    } else if (route.tool === "revise") {
      setEphemeralHint("正在按你的意见改版…");
    }

    if (route.tool === "generate" && onGenerate) {
      onPersist({ ...base, agentTurns: appendToolAckTurn(prefixWithUser, "generate") });
      try {
        await onGenerate();
      } finally {
        setEphemeralHint("");
      }
      return;
    }
    if (route.tool === "revise" && onReviseFromChat) {
      onPersist({ ...base, agentTurns: appendToolAckTurn(prefixWithUser, "revise") });
      try {
        await onReviseFromChat(q);
      } finally {
        setEphemeralHint("");
      }
      return;
    }

    await runAgentTurn(prefixWithUser, q, base, route);
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat) return;
    abortBackgroundStreams();
    setInput("");

    const userTurn: StudioAgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: Date.now()
    };
    const prefixWithUser = [...turns, userTurn];
    const route = routeStudioAction(
      { ...work, agentTurns: prefixWithUser },
      q,
      prefixWithUser
    );
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
    await dispatchRoutedSend(prefixWithUser, q, route, base);
  }

  async function handleEditUserTurn(turnId: string, newText: string) {
    abortBackgroundStreams();
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0 || turns[idx]?.role !== "user") return;
    const prefix = turns.slice(0, idx);
    const truncated = workAfterTruncateTurns(work, prefix);
    onPersist(truncated);

    const userTurn: StudioAgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: newText.trim(),
      createdAt: Date.now()
    };
    const prefixWithUser = [...prefix, userTurn];
    const route = routeStudioAction(
      { ...truncated, agentTurns: prefixWithUser },
      newText.trim(),
      prefixWithUser
    );
    const base = syncWorkTitleFromTurns(
      { ...truncated, agentTurns: prefixWithUser, lastOrchestratorNote: route.note, error: undefined },
      prefixWithUser
    );
    onPersist(base);

    await dispatchRoutedSend(prefixWithUser, newText.trim(), route, base);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-3 py-3">
        <div
          ref={dialogueScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <StudioDialoguePanel
            turns={dialogueTurns}
            streamingPhase={phase}
            scrollRef={dialogueScrollRef}
            canEdit={canEditTurns}
            onEditUserTurn={(turnId, text) => void handleEditUserTurn(turnId, text)}
            emptyHint={dialogueEmptyHint}
          />
          {showManuscriptSection ? (
            <StudioDraftCanvas
              embedded
              work={work}
              busy={agentBusy || jobBusy}
              activeVersion={activeVersion}
              versions={versions}
              onVersionChange={onVersionChange}
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
              onTitleIndexChange={onTitleIndexChange}
              onBlocksChange={onBlocksChange}
              onSelectionRevise={onSelectionRevise}
              onWowRevise={onWowRevise}
            />
          ) : null}
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
            busy={agentBusy || (jobRunning && Boolean(input.trim()))}
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
