"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import { shouldRejectDeliverableBody } from "../../lib/studioDeliverableQuality";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { buildBlockPatchOpinion, buildSelectionPatchOpinion } from "../../lib/studioBlockPatch";
import {
  buildStudioAuthorPrompt,
  buildStudioJobIntake,
  buildStudioReviseTaskSentence
} from "../../lib/studioWorkIntake";
import { getComposerPrefsFeatureCore, getStudioWork, upsertStudioWork } from "../../lib/studioWorkStorage";
import {
  appendStudioRun,
  finishStudioRun,
  patchStudioGeneratePhase
} from "../../lib/studioOrchestrator";
import { buildStudioAskPayload, studioTurnsToMemoryTurns } from "../../lib/studioAgentAsk";
import { streamStudioAgentAsk } from "../../lib/studioAgentAskStream";
import { formatStudioAskError } from "../../lib/studioAskError";
import { streamStudioAgent } from "../../lib/studioAgentStream";
import { studioAgentRouteHint } from "../../lib/studioAgentToolSchema";
import { upsertAgentStep, type StudioAgentStep } from "../../lib/studioAgentSteps";
import {
  STUDIO_ACK_GENERATE,
  STUDIO_ACK_REVISE,
  appendComposeClarifyTurn,
  buildStudioBriefClarifyAssistantTurn
} from "../../lib/studioTimeline";
import {
  classifyComposeSoftFailure,
  studioComposeFailureNote,
  type StudioComposeSoftFailure
} from "../../lib/studioComposeFailure";
import { blocksFromComposeStream, hasComposePreviewContent } from "../../lib/studioComposePreview";
import { applyPendingPatch, discardPendingPatch } from "../../lib/studioPatchApply";
import { drainFollowUps } from "../../lib/studioFollowUpQueue";
import { shouldForceStudioCompose } from "../../lib/studioComposeChip";
import { classifyStudioFailure } from "../../lib/studioAgentFailure";
import { mergeDomainContext, type StudioDomain } from "../../lib/studioDomainProfile";
import { shouldAutoApplyPatch, shouldShowQualityNote, type StudioEditorMode } from "../../lib/studioEditorMode";
import { captureUndoSnapshot, applyUndoSnapshot } from "../../lib/studioUndo";
import { shouldSuppressStudioCanvasReply } from "../../lib/studioAgentStructured";
import { composeTaskSentenceFromTurns, firstUserSentenceFromTurns, syncWorkTitleFromTurns } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  PendingPatch,
  StudioAgentTurn,
  StudioWork,
  WorkStatus
} from "../../lib/studioWorkTypes";
import { buildPendingPatchFromBlocks } from "../../lib/studioPatchApply";
import StudioAgentDock from "./StudioAgentDock";
import StudioSessionRail from "./StudioSessionRail";

type CanvasSnapshot = {
  versions: ManuscriptVersion[];
  activeVersionId: string;
  status: WorkStatus;
};

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [streamingBlocks, setStreamingBlocks] = useState<ManuscriptBlock[] | null>(null);
  const [streamingBodyText, setStreamingBodyText] = useState<string | null>(null);
  const [patchSelections, setPatchSelections] = useState<Set<string>>(new Set());
  const streamingBlocksRef = useRef<ManuscriptBlock[] | null>(null);
  const streamingBodyRef = useRef<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const reviseQueueRef = useRef<string[]>([]);
  const jobRunningRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const cancelModeRef = useRef<"stop" | "discard">("stop");
  const activeStreamTurnIdRef = useRef<string>("");
  const canvasSnapshotsRef = useRef<Map<string, CanvasSnapshot>>(new Map());
  const [agentRouteHint, setAgentRouteHint] = useState("");
  const [agentSteps, setAgentSteps] = useState<StudioAgentStep[]>([]);
  const [selectedSnippet, setSelectedSnippet] = useState("");
  const [applyToast, setApplyToast] = useState<string | null>(null);
  const parallelAskAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    const w = getStudioWork(workId);
    setWork(w);
    return w;
  }, [workId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
    parallelAskAbortRef.current?.abort();
  }, []);

  const activeVersion = useMemo(
    () => work?.versions.find((v) => v.id === work.activeVersionId) ?? work?.versions[work?.versions.length - 1],
    [work]
  );

  function persist(next: StudioWork): StudioWork {
    const saved = upsertStudioWork({ ...next, allowModelFallback: true });
    setWork(saved);
    return saved;
  }

  const restoreCanvasBeforeTurn = useCallback(
    (turnId: string) => {
      const snap = canvasSnapshotsRef.current.get(turnId);
      const cur = getStudioWork(workId);
      if (!snap || !cur) return;
      persist({
        ...cur,
        versions: snap.versions,
        activeVersionId: snap.activeVersionId,
        status: snap.status,
        error: undefined,
        runPhase: undefined,
        pendingPatch: undefined
      });
      setStreamingBlocks(null);
      setStreamingBodyText(null);
    },
    [workId]
  );

  const clearStreamingSurface = useCallback(() => {
    streamingBlocksRef.current = null;
    streamingBodyRef.current = null;
    setStreamingBlocks(null);
    setStreamingBodyText(null);
  }, []);

  const cancelAgentStreamStop = useCallback(() => {
    cancelModeRef.current = "stop";
    streamAbortRef.current?.abort();
  }, []);

  const cancelAgentStreamDiscard = useCallback(() => {
    cancelModeRef.current = "discard";
    streamAbortRef.current?.abort();
    const turnId = activeStreamTurnIdRef.current;
    if (turnId) restoreCanvasBeforeTurn(turnId);
    clearStreamingSurface();
  }, [restoreCanvasBeforeTurn, clearStreamingSurface]);

  const undoLastApply = useCallback(() => {
    const cur = getStudioWork(workId);
    if (!cur?.undoSnapshot) return;
    persist(applyUndoSnapshot(cur, cur.undoSnapshot));
    setPatchSelections(new Set());
    setApplyToast(null);
  }, [workId]);

  const applyPatch = useCallback(
    (partial: boolean) => {
      const cur = getStudioWork(workId);
      if (!cur?.pendingPatch) return;
      const keys: Set<string> =
        partial && patchSelections.size
          ? patchSelections
          : new Set(cur.pendingPatch.selections ?? cur.pendingPatch.changedKeys ?? []);
      const undoSnap = captureUndoSnapshot(cur);
      persist(
        finishStudioRun(
          {
            ...applyPendingPatch(cur, cur.pendingPatch, { partial, selectedKeys: keys }),
            undoSnapshot: undoSnap
          },
          cur.pendingPatch.sourceRunId ?? "",
          "done",
          partial ? "已采纳所选改动" : "已采纳全部改动"
        )
      );
      setPatchSelections(new Set());
      setApplyToast(partial ? "已采纳所选改动" : "已采纳全部改动");
    },
    [workId, patchSelections]
  );

  const discardPatch = useCallback(() => {
    const cur = getStudioWork(workId);
    if (!cur?.pendingPatch) return;
    persist(discardPendingPatch(cur));
    setPatchSelections(new Set());
  }, [workId]);

  const togglePatchKey = useCallback((key: string) => {
    setPatchSelections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const runAgentStream = useCallback(
    async (params: {
      userText: string;
      prefixTurns: StudioAgentTurn[];
      userTurnId: string;
      forceCompose?: boolean;
      selectionSnippet?: string;
    }) => {
      const cur0 = getStudioWork(workId);
      if (!cur0 || !isLoggedIn) return;

      let outgoingText = params.userText;
      const snippet = params.selectionSnippet?.trim();
      if (snippet && !outgoingText.startsWith("【块级改版】")) {
        outgoingText = buildSelectionPatchOpinion(snippet, params.userText);
      }

      const domainCtx = mergeDomainContext(
        { domain: cur0.domain, format: cur0.format },
        outgoingText
      );
      const cur: StudioWork = { ...cur0, domain: domainCtx.domain, format: domainCtx.format };
      persist(cur);

      canvasSnapshotsRef.current.set(params.userTurnId, {
        versions: cur.versions,
        activeVersionId: cur.activeVersionId,
        status: cur.status
      });

      const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, outgoingText);
      const intake = buildStudioJobIntake(composeTask, cur.intake);
      const authorPrompt = buildStudioAuthorPrompt(composeTask);

      const baseVersion =
        cur.versions.find((v) => v.id === cur.activeVersionId) ?? cur.versions.at(-1);
      const isReviseIntent =
        Boolean(baseVersion) &&
        (Boolean(snippet) ||
          /改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化/.test(
            params.userText
          ));
      const effectiveTaskSentence =
        isReviseIntent && baseVersion
          ? buildStudioReviseTaskSentence(
              composeTask,
              manuscriptCopyAll(baseVersion.blocks, baseVersion.primaryTitleIndex ?? 0),
              outgoingText
            )
          : composeTask;

      activeStreamTurnIdRef.current = params.userTurnId;
      cancelModeRef.current = "stop";

      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      setAgentRouteHint("");
      setAgentSteps([]);
      streamingBlocksRef.current = null;
      streamingBodyRef.current = null;
      const clientRunId = crypto.randomUUID();
      let runId = clientRunId;
      let runTool: "generate" | "revise" = "generate";
      let ackAppended = false;

      const proposePendingPatch = (
        after: StudioWork,
        patch: PendingPatch,
        params: { userText: string; prefixTurns: StudioAgentTurn[] },
        qualityWeak = false
      ) => {
        const fullPatch: PendingPatch = {
          ...patch,
          sourceRunId: runId,
          qualityNote:
            qualityWeak && shouldShowQualityNote(after.editorMode)
              ? patch.qualityNote ?? "略模板化 · 可继续 patch 语气"
              : patch.qualityNote
        };

        if (shouldAutoApplyPatch(after.editorMode)) {
          const keys = new Set<string>(fullPatch.changedKeys ?? fullPatch.selections ?? []);
          const undoSnap = captureUndoSnapshot(after);
          const withPending = { ...after, pendingPatch: fullPatch, status: "ready" as const };
          persist(
            finishStudioRun(
              {
                ...applyPendingPatch(withPending, fullPatch, {
                  partial: false,
                  selectedKeys: keys
                }),
                undoSnapshot: undoSnap,
                plan: undefined,
                intake: runTool === "generate" ? intake : after.intake,
                runPhase: undefined,
                error: undefined,
                lastOrchestratorNote: undefined
              },
              runId,
              "done",
              fullPatch.summary
            )
          );
          setPatchSelections(new Set());
          setApplyToast(fullPatch.summary || "已采纳改动");
          setAgentRouteHint("");
          setAgentSteps([]);
          if (streamAbortRef.current === ac) clearStreamingSurface();
          return;
        }

        let next: StudioWork = finishStudioRun(
          {
            ...after,
            status: "ready",
            plan: undefined,
            intake: runTool === "generate" ? intake : after.intake,
            pendingPatch: fullPatch,
            runPhase: undefined,
            error: undefined,
            lastOrchestratorNote: undefined
          },
          runId,
          "done",
          fullPatch.summary
        );
        persist(next);
        setPatchSelections(new Set(fullPatch.selections ?? fullPatch.changedKeys ?? []));
        setAgentRouteHint("");
        setAgentSteps([]);
        if (streamAbortRef.current === ac) {
          clearStreamingSurface();
        }
      };

      const finishSoftComposeFailure = (
        after: StudioWork,
        failureKind: StudioComposeSoftFailure,
        params: { userText: string; prefixTurns: StudioAgentTurn[] },
        fallbackBlocks: ManuscriptBlock[] = [],
        empty = false
      ) => {
        const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, outgoingText);
        const clarifyTurn = buildStudioBriefClarifyAssistantTurn(
          empty ? "empty" : "template",
          params.userText,
          composeTask
        );
        persist(
          finishStudioRun(
            {
              ...after,
              agentTurns: appendComposeClarifyTurn(after.agentTurns ?? [], clarifyTurn),
              status: "draft",
              error: undefined,
              runPhase: undefined,
              lastOrchestratorNote: studioComposeFailureNote(failureKind)
            },
            runId,
            "error",
            studioComposeFailureNote(failureKind)
          )
        );
      };

      const ensureComposeRun = (tool: "generate" | "revise") => {
        if (ackAppended) return;
        ackAppended = true;
        runTool = tool;
        const live = getStudioWork(workId);
        if (!live) return;
        const ackTurn: StudioAgentTurn = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: tool === "generate" ? STUDIO_ACK_GENERATE : STUDIO_ACK_REVISE,
          intent: "compose_ack",
          createdAt: Date.now()
        };
        const ackTurns = [...params.prefixTurns, ackTurn];
        const { work: withRun } = appendStudioRun(
          live,
          tool,
          tool === "generate" ? "写稿中" : "改版中…",
          "running",
          { anchorTurnId: ackTurn.id, runId: clientRunId }
        );
        persist(
          patchStudioGeneratePhase(
            {
              ...withRun,
              agentTurns: ackTurns,
              status: "generating",
              plan: undefined,
              error: undefined,
              pendingPatch: undefined,
              allowModelFallback: true
            },
            runId,
            tool === "generate" ? "写稿中" : "改版中…"
          )
        );
        setStreamingBlocks([]);
        setStreamingBodyText("");
        streamingBlocksRef.current = null;
        streamingBodyRef.current = null;
      };

      const manuscriptBlocks = baseVersion?.blocks ?? [];

      try {
        const result = await streamStudioAgent({
          message: outgoingText,
          agentTurns: params.prefixTurns,
          status: cur.status,
          versionCount: cur.versions.length,
          taskSentence: effectiveTaskSentence,
          intake,
          notebook: cur.binding.notebook,
          noteIds: cur.binding.noteIds,
          featureCore: getComposerPrefsFeatureCore() as unknown as Record<string, unknown>,
          authorPrompt,
          agentMode: "write",
          manuscriptBlocks,
          activeVersionId: cur.activeVersionId,
          clientRunId,
          forceCompose: params.forceCompose,
          authHeaders: getAuthHeaders(),
          signal: ac.signal,
          onStep: (step) => setAgentSteps((prev) => upsertAgentStep(prev, step)),
          onRoute: (route) => {
            setAgentRouteHint(studioAgentRouteHint(route, "write"));
            const live = getStudioWork(workId);
            if (live && route.reason?.trim()) {
              persist({ ...live, lastPlannerReason: route.reason.trim() });
            }
          },
          onReply: (text) => {
            const live = getStudioWork(workId);
            if (!live || !text.trim()) return;
            if (shouldSuppressStudioCanvasReply(live, params.userText)) return;
            const lastAssistant = live.agentTurns?.filter((t: StudioAgentTurn) => t.role === "assistant").at(-1);
            if (lastAssistant?.content.trim() === text.trim()) return;
            const assistantTurn: StudioAgentTurn = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: text.trim(),
              createdAt: Date.now()
            };
            persist({
              ...live,
              agentTurns: [...(live.agentTurns ?? []), assistantTurn],
              error: undefined
            });
          },
          onPhase: (msg, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            const live = getStudioWork(workId);
            if (!live || !runId) return;
            persist(patchStudioGeneratePhase(live, runId, msg));
          },
          onBlockDelta: (blocks, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            streamingBlocksRef.current = blocks;
            setStreamingBlocks(blocks);
          },
          onBodyDelta: (body, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            streamingBodyRef.current = body;
            setStreamingBodyText(body);
          },
          onStreamReset: (tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            streamingBlocksRef.current = null;
            streamingBodyRef.current = null;
            setStreamingBlocks([]);
            setStreamingBodyText("");
          }
        });

        if (ac.signal.aborted || result.status === "aborted") {
          const live = getStudioWork(workId);
          const cancelMode = cancelModeRef.current as "stop" | "discard";
          if (cancelMode === "discard") {
            return;
          }
          if (live && runId) {
            const streamBlocks = blocksFromComposeStream(
              streamingBlocksRef.current,
              streamingBodyRef.current,
              []
            );
            if (streamBlocks.length && hasComposePreviewContent(streamBlocks)) {
              proposePendingPatch(
                live,
                buildPendingPatchFromBlocks({
                  fromVersionId: live.activeVersionId,
                  baseBlocks: baseVersion?.blocks ?? [],
                  proposedBlocks: streamBlocks,
                  summary: "部分成稿",
                  reason: "已停止 · 保留部分改动",
                  sourceRunId: runId,
                  qualityNote: shouldShowQualityNote(live.editorMode) ? "建议核对后采纳" : undefined
                }),
                params,
                false
              );
              return;
            }
            const failCopy = classifyStudioFailure("", true);
            persist(
              finishStudioRun(
                {
                  ...live,
                  status: runTool === "generate" ? "draft" : live.versions.length ? "ready" : "draft",
                  runPhase: undefined,
                  error: failCopy.message,
                  lastFailureCode: failCopy.code
                },
                runId,
                "error",
                failCopy.message
              )
            );
          }
          return;
        }

        const after = getStudioWork(workId);
        if (!after) return;

        if (result.status === "reply") {
          const text = result.text.trim();
          const suppressReply = shouldSuppressStudioCanvasReply(after, params.userText);
          const lastAssistant = after.agentTurns?.filter((t: StudioAgentTurn) => t.role === "assistant").at(-1);
          if (!suppressReply && text && lastAssistant?.content !== text) {
            persist({
              ...after,
              agentTurns: [
                ...(after.agentTurns ?? []),
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: text,
                  createdAt: Date.now()
                }
              ],
              status: runTool === "generate" && !after.versions.length ? "draft" : after.status,
              error: undefined,
              runPhase: undefined
            });
          }
          if (runId && ackAppended) {
            persist(
              finishStudioRun(
                {
                  ...getStudioWork(workId)!,
                  status: after.versions.length ? after.status : "draft",
                  runPhase: undefined,
                  error: undefined
                },
                runId,
                "error",
                "已转为对话"
              )
            );
          }
          return;
        }

        if (result.status === "error") {
          if (/^network error$/i.test(result.error) || /failed to fetch/i.test(result.error)) {
            if (ac.signal.aborted || streamAbortRef.current !== ac) return;
          }
          const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, outgoingText);
          const failureKind = classifyComposeSoftFailure(result.error, composeTask);
          const streamBlocks = blocksFromComposeStream(
            streamingBlocksRef.current,
            streamingBodyRef.current,
            []
          );
          if (runId && failureKind === "needs_rewrite" && hasComposePreviewContent(streamBlocks)) {
            const baseBlocks = baseVersion?.blocks ?? [];
            proposePendingPatch(
              after,
              buildPendingPatchFromBlocks({
                fromVersionId: after.activeVersionId,
                baseBlocks,
                proposedBlocks: streamBlocks,
                summary: "改版提议",
                reason: "流式成稿未完整结束，保留当前预览",
                sourceRunId: runId,
                qualityNote: "建议核对后采纳"
              }),
              params,
              true
            );
            return;
          }
          if (runId && failureKind === "needs_brief") {
            finishSoftComposeFailure(after, failureKind, params, streamBlocks, !hasComposePreviewContent(streamBlocks));
            setAgentRouteHint("");
            setAgentSteps([]);
            return;
          }
          if (runId) {
            const failCopy = classifyStudioFailure(result.error);
            persist(
              finishStudioRun(
                {
                  ...after,
                  status: runTool === "generate" ? "draft" : "ready",
                  error: failCopy.message,
                  lastFailureCode: failCopy.code,
                  runPhase: undefined
                },
                runId,
                "error",
                failCopy.message
              )
            );
          } else {
            persist({ ...after, error: result.error });
          }
          return;
        }

        let blocks =
          result.status === "patch" ? result.blocks : result.status === "done" ? result.blocks : [];
        if (!blocks.length) {
          blocks = blocksFromComposeStream(streamingBlocksRef.current, streamingBodyRef.current, []);
        }
        if (!blocks.length) {
          finishSoftComposeFailure(after, "needs_brief", params, [], true);
          setAgentRouteHint("");
          setAgentSteps([]);
          return;
        }

        const bodyText = blocks.find((b) => b.kind === "body")?.text ?? "";
        const qualityWeak =
          result.tool === "compose" && shouldRejectDeliverableBody(result.tool, bodyText);
        const patch: PendingPatch =
          result.status === "patch"
            ? result.pendingPatch
            : buildPendingPatchFromBlocks({
                fromVersionId: after.activeVersionId,
                baseBlocks: baseVersion?.blocks ?? [],
                proposedBlocks: blocks,
                summary: result.tool === "revise" ? "改版提议" : "首稿",
                reason: agentRouteHint || (result.tool === "revise" ? "按你的意见修改" : "首稿成稿"),
                sourceRunId: runId
              });
        proposePendingPatch(after, patch, params, qualityWeak);
      } catch (err) {
        if (ac.signal.aborted) return;
        const failed = getStudioWork(workId);
        const msg = String(err instanceof Error ? err.message : err);
        if (/^network error$/i.test(msg) || /failed to fetch/i.test(msg)) {
          return;
        }
        if (failed && runId) {
          persist(
            finishStudioRun(
              { ...failed, status: runTool === "generate" ? "draft" : "ready", error: msg, runPhase: undefined },
              runId,
              "error",
              msg
            )
          );
        } else if (failed) {
          persist({ ...failed, error: msg });
        }
      } finally {
        if (streamAbortRef.current === ac) {
          clearStreamingSurface();
        }
        if (streamAbortRef.current === ac) streamAbortRef.current = null;
      }
    },
    [workId, isLoggedIn, getAuthHeaders, clearStreamingSurface]
  );

  const runReviseJob = useCallback(
    async (opinion: string) => {
      const latest = getStudioWork(workId) ?? work;
      if (!latest || !isLoggedIn) return;
      const base =
        latest.versions.find((v) => v.id === latest.activeVersionId) ?? latest.versions.at(-1);
      if (!base) return;

      const text = buildBlockPatchOpinion(opinion);
      const userTurn: StudioAgentTurn = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now()
      };
      const prefix = [...(latest.agentTurns ?? []), userTurn];
      persist({ ...latest, agentTurns: prefix, error: undefined });
      await runAgentStream({ userText: text, prefixTurns: prefix, userTurnId: userTurn.id });
    },
    [workId, work, isLoggedIn, runAgentStream]
  );

  const runJobExclusive = useCallback(
    async (fn: () => Promise<void>) => {
      if (jobRunningRef.current) return false;
      jobRunningRef.current = true;
      setJobBusy(true);
      try {
        await fn();
      } finally {
        jobRunningRef.current = false;
        setJobBusy(false);
        load();
        const latest = getStudioWork(workId);
        const drained = latest ? drainFollowUps(latest) : null;
        if (drained && drained.texts.length) {
          persist(drained.work);
          const merged = drained.texts.join("；");
          void runJobExclusive(() => runReviseJob(merged));
          return true;
        }
        const queued = reviseQueueRef.current.shift();
        if (queued) {
          void runJobExclusive(() => runReviseJob(queued));
        }
      }
      return true;
    },
    [load, runReviseJob]
  );

  function onQueueRevise(opinion: string) {
    const text = opinion.trim();
    if (!text) return;
    reviseQueueRef.current.push(text);
  }

  function onManuscriptBlocksChange(blocks: ManuscriptBlock[]) {
    if (!work || !activeVersion || work.status !== "ready") return;
    persist({
      ...work,
      versions: work.versions.map((v) => (v.id === activeVersion.id ? { ...v, blocks } : v))
    });
  }

  const runParallelAsk = useCallback(
    async (params: { userText: string; prefixTurns: StudioAgentTurn[] }) => {
      const cur = getStudioWork(workId);
      if (!cur || !isLoggedIn) return;

      parallelAskAbortRef.current?.abort();
      const ac = new AbortController();
      parallelAskAbortRef.current = ac;

      const assistantId = crypto.randomUUID();
      const assistantTurn: StudioAgentTurn = {
        id: assistantId,
        role: "assistant",
        content: "…",
        streaming: true,
        createdAt: Date.now()
      };
      const turnsWithAssistant = [...params.prefixTurns, assistantTurn];
      persist({ ...cur, agentTurns: turnsWithAssistant, error: undefined });

      const version =
        cur.versions.find((v) => v.id === cur.activeVersionId) ?? cur.versions.at(-1);
      const hasCorpus = Boolean(cur.binding.notebook.trim() && cur.binding.noteIds.length > 0);
      const ragMode = hasCorpus ? ("rag" as const) : ("general" as const);
      const askPayload = buildStudioAskPayload({
        work: cur,
        userMessage: params.userText,
        intent: "general",
        activeVersion: version ?? null,
        askFlags: { includeManuscript: true, includeMemory: true },
        mode: ragMode
      });

      try {
        const done = await streamStudioAgentAsk({
          work: cur,
          question: askPayload.question,
          mode: ragMode,
          notebook: cur.binding.notebook,
          noteIds: cur.binding.noteIds,
          memoryTurns: studioTurnsToMemoryTurns(params.prefixTurns),
          sessionState: cur.agentSessionState ?? null,
          dialogueStylePrompt: askPayload.dialogueStylePrompt,
          authorIpPrompt: askPayload.authorIpPrompt,
          authHeaders: getAuthHeaders(),
          signal: ac.signal
        });

        const text = done.displayText.trim() || done.answer.trim() || "（暂无回复）";
        const live = getStudioWork(workId);
        if (!live) return;
        const finalTurns = (live.agentTurns ?? turnsWithAssistant).map((t) =>
          t.id === assistantId ? { ...t, content: text, streaming: false } : t
        );
        persist({ ...live, agentTurns: finalTurns, error: undefined });
      } catch (err) {
        if (ac.signal.aborted) return;
        const live = getStudioWork(workId);
        if (!live) return;
        persist({
          ...live,
          agentTurns: params.prefixTurns,
          error: formatStudioAskError(String(err instanceof Error ? err.message : err))
        });
      } finally {
        if (parallelAskAbortRef.current === ac) parallelAskAbortRef.current = null;
      }
    },
    [workId, isLoggedIn, getAuthHeaders]
  );

  const retryLast = useCallback(() => {
    const cur = getStudioWork(workId);
    if (!cur || !isLoggedIn) return;
    const lastUser = [...(cur.agentTurns ?? [])].reverse().find((t) => t.role === "user");
    if (!lastUser) return;
    const idx = cur.agentTurns?.findIndex((t) => t.id === lastUser.id) ?? -1;
    const prefix = idx >= 0 ? cur.agentTurns!.slice(0, idx + 1) : [lastUser];
    persist({ ...cur, agentTurns: prefix, error: undefined });
    void runJobExclusive(() =>
      runAgentStream({
        userText: lastUser.content,
        prefixTurns: prefix,
        userTurnId: lastUser.id
      })
    );
  }, [workId, isLoggedIn, runAgentStream, runJobExclusive]);

  const onEditorModeChange = useCallback(
    (mode: StudioEditorMode) => {
      const cur = getStudioWork(workId);
      if (!cur) return;
      persist({ ...cur, editorMode: mode });
    },
    [workId]
  );

  const onDomainChange = useCallback(
    (domain: StudioDomain) => {
      const cur = getStudioWork(workId);
      if (!cur) return;
      persist({ ...cur, domain });
    },
    [workId]
  );

  if (!work) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-sm text-muted">
        任务不存在 ·{" "}
        <Link href={WORKBENCH_STUDIO_PATH} className="text-brand">
          返回
        </Link>
      </main>
    );
  }

  return (
    <main className="flex h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden">
      <div className="hidden lg:contents">
        <StudioSessionRail
          activeWorkId={workId}
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((c) => !c)}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <StudioAgentDock
          work={work}
          isLoggedIn={isLoggedIn}
          ready={ready}
          jobBusy={jobBusy}
          canvasMode
          agentRouteHint={agentRouteHint}
          agentSteps={agentSteps}
          streamingBlocks={streamingBlocks}
          streamingBodyText={streamingBodyText}
          pendingPatch={work.pendingPatch}
          patchSelections={patchSelections}
          onApplyPatch={applyPatch}
          onDiscardPatch={discardPatch}
          onTogglePatchKey={togglePatchKey}
          getAuthHeaders={getAuthHeaders}
          onPersist={persist}
          onAgentRun={async ({ userText, prefixTurns, userTurnId, forceCompose, selectionSnippet }) => {
            if (selectionSnippet) setSelectedSnippet("");
            await runJobExclusive(() =>
              runAgentStream({ userText, prefixTurns, userTurnId, forceCompose, selectionSnippet })
            );
          }}
          onQueueRevise={onQueueRevise}
          onRestoreCanvasBeforeTurn={restoreCanvasBeforeTurn}
          onCancelStream={cancelAgentStreamStop}
          onDiscardStream={cancelAgentStreamDiscard}
          onUndoApply={undoLastApply}
          applyToast={applyToast}
          onDismissApplyToast={() => setApplyToast(null)}
          selectedSnippet={selectedSnippet}
          onSelectionChange={setSelectedSnippet}
          onParallelAsk={runParallelAsk}
          onRetryLast={retryLast}
          onEditorModeChange={onEditorModeChange}
          onDomainChange={onDomainChange}
          showFeatureNudge={false}
          onDismissFeatureNudge={() => persist({ ...work, featureNudgeDismissed: true })}
          onTitleIndexChange={(index) => {
            if (!work || !activeVersion) return;
            persist({
              ...work,
              versions: work.versions.map((v) =>
                v.id === activeVersion.id ? { ...v, primaryTitleIndex: index } : v
              )
            });
          }}
          onBlocksChange={onManuscriptBlocksChange}
        />
      </div>
    </main>
  );
}
