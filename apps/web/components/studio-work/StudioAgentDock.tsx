"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildStudioAskPayload,
  studioTurnsToMemoryTurns
} from "../../lib/studioAgentAsk";
import { STUDIO_ACK_GENERATE, STUDIO_ACK_REVISE } from "../../lib/studioTimeline";
import { isDraftLikeStatus } from "../../lib/studioWorkMigrate";
import { routeStudioAction, type StudioRouteDecision } from "../../lib/studioOrchestrator";
import { studioOrchestratorHint } from "../../lib/studioOrchestratorHints";
import { formatStudioAskError } from "../../lib/studioAskError";
import { featureCoreToPrompt } from "../../lib/homeComposerFeatureCore";
import { personalProfileToPrompt } from "../../lib/homeComposerProfile";
import {
  getComposerPrefsFeatureCore,
  getStudioComposerPrefs,
  getStudioWork
} from "../../lib/studioWorkStorage";
import { composeTaskSentenceFromTurns, firstUserSentenceFromTurns, syncWorkTitleFromTurns } from "../../lib/studioWorkTask";
import { suggestStudioWorkTitleLlm } from "../../lib/studioWorkTitleSuggest";
import {
  resetStudioRagWarmOnBindingChange,
  softenStudioRagPhaseMessage,
  studioCorpusBindingKey
} from "../../lib/studioAskPhase";
import { buildStudioDialogueTurnGroups } from "../../lib/studioDialogueTurnGroups";
import { markOpenComposerFeature } from "../../lib/studioComposerFeatureLink";
import { WORKBENCH_CHAT_PATH } from "../../lib/navPaths";
import type { StudioAgentStep } from "../../lib/studioAgentSteps";
import { streamStudioAgentAsk } from "../../lib/studioAgentAskStream";
import { mergeBriefChipReply } from "../../lib/studioBriefMerge";
import { shouldForceStudioCompose } from "../../lib/studioComposeChip";
import {
  STUDIO_STRUCTURED_OUTPUT_ENABLED,
  draftAskFallbackText,
  opsStrategySuggestedReplies,
  resolveStudioStructuredResponse,
  studioStructuredAddsAssistantTurn,
  userMessageLooksLikeQuestion
} from "../../lib/studioAgentStructured";
import type { StudioComposePreview } from "../../lib/studioComposePreview";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  StudioAgentTurn,
  StudioWork,
  WorkStatus
} from "../../lib/studioWorkTypes";
import StudioAgentStepBar from "./StudioAgentStepBar";
import StudioEphemeralHint from "./StudioEphemeralHint";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioTimelinePanel from "./StudioTimelinePanel";
import StudioCorpusBar from "./StudioCorpusBar";

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
  if (status === "generating") return "写稿进行中，可继续描述或提问…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  return "描述想创作的内容，或提问钩子、结构、运营…";
}

function appendToolAckTurn(
  turns: StudioAgentTurn[],
  tool: "generate" | "revise"
): StudioAgentTurn[] {
  const content = tool === "generate" ? STUDIO_ACK_GENERATE : STUDIO_ACK_REVISE;
  return [
    ...turns,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      intent: "compose_ack",
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
  onAgentRun,
  onGenerate,
  onReviseFromChat,
  onQueueRevise,
  onRestoreCanvasBeforeTurn,
  onCancelStream,
  showFeatureNudge,
  onDismissFeatureNudge,
  onTitleIndexChange,
  onBlocksChange,
  canvasMode = false,
  agentRouteHint = "",
  agentSteps = [],
  streamingBlocks = null,
  streamingBodyText = null,
  composePreview = null,
  onAdoptComposePreview
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  jobBusy: boolean;
  canvasMode?: boolean;
  /** 单 Agent 路由提示（reply / compose / revise） */
  agentRouteHint?: string;
  agentSteps?: StudioAgentStep[];
  streamingBlocks?: ManuscriptBlock[] | null;
  streamingBodyText?: string | null;
  composePreview?: StudioComposePreview | null;
  onAdoptComposePreview?: () => void;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  /** 单 Agent SSE（reply | compose | revise）；提供时优先于 ask+Job 双轨 */
  onAgentRun?: (params: {
    userText: string;
    prefixTurns: StudioAgentTurn[];
    userTurnId: string;
    forceCompose?: boolean;
  }) => void | Promise<void>;
  onGenerate?: () => void | Promise<void>;
  onReviseFromChat?: (opinion: string) => void | Promise<void>;
  onQueueRevise?: (opinion: string) => void;
  onRestoreCanvasBeforeTurn?: (turnId: string) => void;
  onCancelStream?: () => void;
  showFeatureNudge: boolean;
  onDismissFeatureNudge: () => void;
  onTitleIndexChange?: (index: number) => void;
  onBlocksChange?: (blocks: ManuscriptBlock[]) => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const agentBusyRef = useRef(false);
  const [phase, setPhase] = useState("");
  const [corpusMenuOpen, setCorpusMenuOpen] = useState(false);
  const [ephemeralHint, setEphemeralHint] = useState("");
  const [quickPromptsOpen, setQuickPromptsOpen] = useState(false);
  const dialogueScrollRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
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
  const activeVersion = useMemo(
    () => work.versions.find((v) => v.id === work.activeVersionId) ?? work.versions.at(-1) ?? null,
    [work.activeVersionId, work.versions]
  );
  const dialogueTurns = streamOverlay ?? turns;
  const jobRunning = work.status === "generating" || jobBusy;
  const canChat = isLoggedIn && ready;
  const showQuickPrompts = turns.length === 0 && isDraftLikeStatus(work.status) && !jobRunning;
  const canEditTurns = canChat && !agentBusy;
  const dialogueEmptyHint = undefined;
  const centerEmptyComposer =
    canvasMode && turns.length === 0 && isDraftLikeStatus(work.status) && !jobRunning;
  const useAgentStream = Boolean(onAgentRun);
  const hasComposeStream = Boolean(streamingBlocks?.length || streamingBodyText?.trim());
  const showAgentSteps = canvasMode && (jobRunning || agentBusy) && agentSteps.length > 0;
  const showEphemeralHint =
    canvasMode &&
    Boolean(ephemeralHint) &&
    !showAgentSteps &&
    !hasComposeStream;
  const showAgentOutputStatus = showAgentSteps || showEphemeralHint;
  const dockPhase = useAgentStream ? phase || undefined : phase || undefined;

  const scrollToActiveUser = useCallback(() => {
    dialogueScrollRef.current
      ?.querySelector('[data-studio-user-anchor="active"]')
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const scrollOutputToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    scrollEndRef.current?.scrollIntoView({ block: "end", behavior });
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

  useEffect(() => {
    if (centerEmptyComposer) return;
    const id = requestAnimationFrame(() => scrollOutputToEnd());
    return () => cancelAnimationFrame(id);
  }, [
    turns.length,
    streamingBlocks,
    streamingBodyText,
    agentSteps.length,
    agentRouteHint,
    ephemeralHint,
    phase,
    jobRunning,
    agentBusy,
    centerEmptyComposer,
    scrollOutputToEnd
  ]);

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
            const preview = answerBuf.trim() || supplementBuf.trim();
            if (!preview) return;
            flushStreamOverlayFrame(assistantId, preview, baseTurns, intent);
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
        const clarify = draftAskFallbackText(workBase, q, rawFallback, prefixTurns);
        if (clarify) {
          const finalTurns = baseTurns.map((t) =>
            t.id === assistantId
              ? {
                  ...t,
                  content: clarify,
                  streaming: false,
                  intent,
                  suggestedReplies:
                    intent === "ops_strategy"
                      ? opsStrategySuggestedReplies(workBase)
                      : undefined,
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
              suggestedReplies:
                intent === "ops_strategy" ? opsStrategySuggestedReplies(workBase) : undefined,
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
      setEphemeralHint("信息够了，正在流式写稿…");
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

  function resolveOutgoingMessage(raw: string, fromChip = false): string {
    const text = raw.trim();
    if (!text) return "";
  if (!fromChip) return text;
  if (/^继续问/.test(text)) return text;
  const priorCompose = composeTaskSentenceFromTurns(turns);
    return mergeBriefChipReply(priorCompose, text);
  }

  async function handleSend(overrideText?: string, fromChip = false) {
    const q = resolveOutgoingMessage(overrideText ?? input, fromChip);
    if (!q || !canChat) return;
    if (
      useAgentStream &&
      jobRunning &&
      !/改版|改一下|改标题|改正文|缩短|加长|重写|润色|优化/.test(q) &&
      !shouldForceStudioCompose(q, fromChip) &&
      !userMessageLooksLikeQuestion(q) &&
      !/钩子|开头|结构|运营|策略|解读|分析|进度|还要多久/.test(q)
    ) {
      setEphemeralHint("写稿进行中，请稍候…");
      return;
    }
    abortBackgroundStreams();
    setInput("");

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
        error: undefined,
        allowModelFallback: true
      },
      prefixWithUser
    );
    onPersist(base);

    if (useAgentStream) {
      if (jobRunning && /改版|改一下|改标题|改正文|缩短|加长|重写|润色|优化/.test(q)) {
        onQueueRevise?.(q);
        setEphemeralHint("已加入改版队列，当前任务完成后执行");
        onPersist({ ...base, agentTurns: appendToolAckTurn(prefixWithUser, "revise") });
        return;
      }
      setAgentBusyState(true);
      try {
        await onAgentRun!({
          userText: q,
          prefixTurns: prefixWithUser,
          userTurnId: userTurn.id,
          forceCompose: shouldForceStudioCompose(q, fromChip)
        });
      } finally {
        setAgentBusyState(false);
        setEphemeralHint("");
      }
      return;
    }

    const route = routeStudioAction(
      { ...work, agentTurns: prefixWithUser },
      q,
      prefixWithUser
    );
    const routedBase = syncWorkTitleFromTurns(
      {
        ...base,
        lastOrchestratorNote: route.note
      },
      prefixWithUser
    );
    onPersist(routedBase);
    await dispatchRoutedSend(prefixWithUser, q, route, routedBase);
  }

  async function handleEditUserTurn(turnId: string, newText: string) {
    abortBackgroundStreams();
    onRestoreCanvasBeforeTurn?.(turnId);
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

    if (useAgentStream) {
      const base = syncWorkTitleFromTurns(
        { ...truncated, agentTurns: prefixWithUser, error: undefined },
        prefixWithUser
      );
      onPersist(base);
      setAgentBusyState(true);
      try {
        await onAgentRun!({
          userText: newText.trim(),
          prefixTurns: prefixWithUser,
          userTurnId: userTurn.id,
          forceCompose: shouldForceStudioCompose(newText.trim(), false)
        });
      } finally {
        setAgentBusyState(false);
      }
      return;
    }

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

  const orchestratorHint = useMemo(
    () => studioOrchestratorHint(work, input, turns),
    [work, input, turns]
  );

  const quickPromptsBlock = showQuickPrompts ? (
    <div className={centerEmptyComposer ? "mt-3" : "mb-2"}>
      <button
        type="button"
        className="text-[11px] text-muted underline hover:text-ink"
        onClick={() => setQuickPromptsOpen((open) => !open)}
      >
        {quickPromptsOpen ? "收起示例" : "试试这些"}
      </button>
      {quickPromptsOpen ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
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
    </div>
  ) : null;

  const loginNotice =
    !isLoggedIn && ready ? (
      <p className="mb-2 text-xs text-warning-ink">
        <Link href="/login" className="text-brand underline">
          登录
        </Link>
        后可用
      </p>
    ) : null;

  const orchestratorHintBlock = orchestratorHint ? (
    <p className="mb-2 rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-1.5 text-[11px] text-ink">
      {orchestratorHint}
    </p>
  ) : null;

  const composer = (
    <StudioAgentComposer
      value={input}
      onChange={setInput}
      onSend={() => void handleSend()}
      busy={agentBusy || (jobRunning && Boolean(input.trim()))}
      disabled={!canChat}
      placeholder={agentPlaceholder(work.status)}
      menuOpen={corpusMenuOpen}
      generating={jobRunning}
      onCancel={jobRunning ? onCancelStream : undefined}
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
  );

  const agentOutputStatus = showAgentOutputStatus ? (
    showAgentSteps ? (
      <StudioAgentStepBar steps={agentSteps} />
    ) : (
      <StudioEphemeralHint text={ephemeralHint} className="text-muted" />
    )
  ) : null;

  const timelinePanel = (
    <StudioTimelinePanel
      work={work}
      turns={dialogueTurns}
      streamingPhase={dockPhase}
      scrollRef={dialogueScrollRef}
      canEdit={canEditTurns}
      onEditUserTurn={(turnId, text) => void handleEditUserTurn(turnId, text)}
      onSuggestedReply={(text) => void handleSend(text, true)}
      emptyHint={dialogueEmptyHint}
      busy={agentBusy || jobBusy}
      hideManuscript={false}
      streamingBlocks={streamingBlocks}
      streamingBodyText={streamingBodyText}
      composePreview={composePreview}
      onAdoptComposePreview={onAdoptComposePreview}
      activeAgentStatus={agentOutputStatus}
      onTitleIndexChange={onTitleIndexChange}
      onBlocksChange={onBlocksChange}
      showFeatureNudge={showFeatureNudge}
      onFillFeature={() => {
        markOpenComposerFeature();
        router.push(WORKBENCH_CHAT_PATH);
      }}
      onDismissFeatureNudge={onDismissFeatureNudge}
    />
  );

  if (centerEmptyComposer) {
    return (
      <div className={["flex min-h-0 flex-col bg-surface", canvasMode ? "h-full" : "flex-1"].join(" ")}>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-3 py-4">
          {loginNotice}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-8">
            <div className="w-full">
              {orchestratorHintBlock}
              {composer}
              {quickPromptsBlock}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={["flex min-h-0 flex-col bg-surface", canvasMode ? "h-full" : "flex-1"].join(" ")}>
      <div
        ref={dialogueScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-auto px-3 py-2 pb-36 text-left"
      >
        <div className="mx-auto w-full max-w-3xl">
          {timelinePanel}
          <div ref={scrollEndRef} className="h-px w-full shrink-0" aria-hidden />
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-line/40 bg-surface/95 px-3 pb-2 pt-1 backdrop-blur-sm supports-[backdrop-filter]:bg-surface/90">
        <div className="mx-auto w-full max-w-3xl">
          {loginNotice}
          {orchestratorHintBlock}
          {composer}
        </div>
      </div>
    </div>
  );
}
