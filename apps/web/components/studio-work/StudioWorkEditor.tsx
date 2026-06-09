"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import { shouldRejectDeliverableBody } from "../../lib/studioDeliverableQuality";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { buildSelectionPatchOpinion } from "../../lib/studioBlockPatch";
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
import {
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
import { shouldForceStudioCompose } from "../../lib/studioComposeChip";
import { classifyStudioFailure } from "../../lib/studioAgentFailure";
import { applyDomainHint, resolveStudioDomainContext } from "../../lib/studioDomainProfile";
import { shouldAutoApplyPatch, shouldShowQualityNote } from "../../lib/studioEditorMode";
import {
  looksLikeManuscriptEditRequest,
  wrapManuscriptEditOpinion
} from "../../lib/studioReviseIntent";
import {
  abortWorkStream,
  clearWorkStream,
  getWorkStreamEntry,
  patchWorkStreamRefs,
  patchWorkStreamUi,
  registerWorkStream,
  subscribeWorkStream,
  workStreamAbortMatches
} from "../../lib/studioWorkStreamRegistry";
import { captureUndoSnapshot, applyUndoSnapshot } from "../../lib/studioUndo";
import { shouldSuppressStudioCanvasReply } from "../../lib/studioAgentStructured";
import { streamStudioAgent } from "../../lib/studioAgentStream";
import { studioAgentRouteHint } from "../../lib/studioAgentToolSchema";
import { upsertAgentStep, type StudioAgentStep } from "../../lib/studioAgentSteps";
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
  const jobRunningRef = useRef(false);
  const activeStreamTurnIdRef = useRef<string>("");
  const canvasSnapshotsRef = useRef<Map<string, CanvasSnapshot>>(new Map());
  const [streamingBlocks, setStreamingBlocks] = useState<ManuscriptBlock[] | null>(null);
  const [streamingBodyText, setStreamingBodyText] = useState<string | null>(null);
  const [streamOptimizing, setStreamOptimizing] = useState(false);
  const [agentRouteHint, setAgentRouteHint] = useState("");
  const [agentSteps, setAgentSteps] = useState<StudioAgentStep[]>([]);
  const [selectedSnippet, setSelectedSnippet] = useState("");

  const load = useCallback(() => {
    const w = getStudioWork(workId);
    setWork(w);
    return w;
  }, [workId]);

  const [patchSelections, setPatchSelections] = useState<Set<string>>(new Set());
  const [jobBusy, setJobBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = subscribeWorkStream(workId, (ui) => {
      setStreamingBlocks(ui.streamingBlocks);
      setStreamingBodyText(ui.streamingBodyText);
      setStreamOptimizing(ui.streamOptimizing);
      setAgentRouteHint(ui.agentRouteHint);
      setAgentSteps(ui.agentSteps);
      setJobBusy(ui.jobBusy);
    });
    return () => {
      unsub();
    };
  }, [workId]);

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
      patchWorkStreamUi(workId, {
        streamingBlocks: null,
        streamingBodyText: null,
        streamOptimizing: false
      });
    },
    [workId]
  );

  const clearStreamingSurface = useCallback(() => {
    patchWorkStreamUi(workId, {
      streamingBlocks: null,
      streamingBodyText: null,
      streamOptimizing: false
    });
    patchWorkStreamRefs(workId, { streamingBlocksRef: null, streamingBodyRef: null });
  }, [workId]);

  const cancelAgentStreamStop = useCallback(() => {
    abortWorkStream(workId, "stop");
    const cur = getStudioWork(workId);
    if (cur?.followUps?.length) {
      persist({ ...cur, followUps: [] });
    }
  }, [workId]);

  const undoLastApply = useCallback(() => {
    const cur = getStudioWork(workId);
    if (!cur?.undoSnapshot) return;
    persist(applyUndoSnapshot(cur, cur.undoSnapshot));
    setPatchSelections(new Set());
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
      const queuedFollowUps = (cur0.followUps ?? []).map((f) => f.text.trim()).filter(Boolean);
      if (queuedFollowUps.length) {
        outgoingText = [...queuedFollowUps, params.userText.trim()].filter(Boolean).join("\n\n");
        persist({ ...cur0, followUps: [] });
      }
      const snippet = params.selectionSnippet?.trim();
      if (snippet && !outgoingText.startsWith("【块级改版】")) {
        outgoingText = buildSelectionPatchOpinion(snippet, params.userText);
      }

      const baseVersion =
        cur0.versions.find((v) => v.id === cur0.activeVersionId) ?? cur0.versions.at(-1);
      const isReviseIntent =
        looksLikeManuscriptEditRequest(params.userText, Boolean(baseVersion)) || Boolean(snippet);
      if (isReviseIntent && !outgoingText.startsWith("【块级改版】")) {
        outgoingText = wrapManuscriptEditOpinion(params.userText);
      }
      const forceReviewPatch =
        isReviseIntent && Boolean(baseVersion?.blocks.length);

      const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, outgoingText);
      const domainCtx = resolveStudioDomainContext({
        hint: { domain: cur0.domain, format: cur0.format },
        userMessage: params.userText,
        taskText: composeTask,
        hasManuscript: isReviseIntent && Boolean(baseVersion?.blocks.length)
      });
      const cur: StudioWork = cur0;
      persist(cur);

      canvasSnapshotsRef.current.set(params.userTurnId, {
        versions: cur.versions,
        activeVersionId: cur.activeVersionId,
        status: cur.status
      });

      const intake = buildStudioJobIntake(composeTask, cur.intake);
      const authorPrompt = buildStudioAuthorPrompt(composeTask);

      const isReviseIntentConfirmed = isReviseIntent;
      const effectiveTaskSentence =
        isReviseIntentConfirmed && baseVersion
          ? buildStudioReviseTaskSentence(
              composeTask,
              manuscriptCopyAll(baseVersion.blocks, baseVersion.primaryTitleIndex ?? 0),
              outgoingText
            )
          : composeTask;

      activeStreamTurnIdRef.current = params.userTurnId;

      const ac = new AbortController();
      registerWorkStream(workId, ac, params.userTurnId);
      patchWorkStreamUi(workId, {
        agentRouteHint: "",
        agentSteps: [],
        streamingBlocks: null,
        streamingBodyText: null,
        streamOptimizing: false,
        jobBusy: true
      });
      const clientRunId = crypto.randomUUID();
      let runId = clientRunId;
      let runTool: "generate" | "revise" = "generate";
      let ackAppended = false;

      const withDomainHint = (w: StudioWork): StudioWork => ({
        ...w,
        ...applyDomainHint(w, domainCtx)
      });

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

        if (shouldAutoApplyPatch(after.editorMode, { forceReview: forceReviewPatch })) {
          const keys = new Set<string>(fullPatch.changedKeys ?? fullPatch.selections ?? []);
          const undoSnap = captureUndoSnapshot(after);
          const withPending = { ...after, pendingPatch: fullPatch, status: "ready" as const };
          persist(
            finishStudioRun(
              withDomainHint({
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
              }),
              runId,
              "done",
              fullPatch.summary
            )
          );
          setPatchSelections(new Set());
          patchWorkStreamUi(workId, { agentRouteHint: "", agentSteps: [] });
          if (workStreamAbortMatches(workId, ac)) clearStreamingSurface();
          return;
        }

        let next: StudioWork = finishStudioRun(
          withDomainHint({
            ...after,
            status: "ready",
            plan: undefined,
            intake: runTool === "generate" ? intake : after.intake,
            pendingPatch: fullPatch,
            runPhase: undefined,
            error: undefined,
            lastOrchestratorNote: undefined
          }),
          runId,
          "done",
          fullPatch.summary
        );
        persist(next);
        setPatchSelections(new Set(fullPatch.selections ?? fullPatch.changedKeys ?? []));
        patchWorkStreamUi(workId, { agentRouteHint: "", agentSteps: [] });
        if (workStreamAbortMatches(workId, ac)) {
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
        const { work: withRun } = appendStudioRun(
          live,
          tool,
          tool === "generate" ? "写稿中" : "改版中…",
          "running",
          { anchorTurnId: params.userTurnId, runId: clientRunId }
        );
        persist(
          patchStudioGeneratePhase(
            {
              ...withRun,
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
        patchWorkStreamUi(workId, {
          streamingBlocks: [],
          streamingBodyText: "",
          streamOptimizing: false,
          agentRouteHint: tool === "generate" ? "正在写稿…" : "正在修改…"
        });
        patchWorkStreamRefs(workId, { streamingBlocksRef: null, streamingBodyRef: null });
      };

      const manuscriptBlocks = baseVersion?.blocks ?? [];

      const runOneStream = (streamMessage: string, streamTaskSentence: string) =>
        streamStudioAgent({
          message: streamMessage,
          agentTurns: params.prefixTurns,
          status: cur.status,
          versionCount: cur.versions.length,
          taskSentence: streamTaskSentence,
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
          domain: domainCtx.domain,
          format: domainCtx.format,
          authHeaders: getAuthHeaders(),
          signal: ac.signal,
          onStep: (step) => {
            const entry = getWorkStreamEntry(workId);
            const next = upsertAgentStep(entry?.ui.agentSteps ?? [], step);
            patchWorkStreamUi(workId, { agentSteps: next });
          },
          onRoute: (route) => {
            const hint = studioAgentRouteHint(route, "write");
            patchWorkStreamUi(workId, { agentRouteHint: hint });
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
            patchWorkStreamUi(workId, { agentRouteHint: msg || (tool === "revise" ? "正在修改…" : "正在写稿…") });
            const live = getStudioWork(workId);
            if (!live || !runId) return;
            persist(patchStudioGeneratePhase(live, runId, msg));
          },
          onBlockDelta: (blocks, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            patchWorkStreamRefs(workId, { streamingBlocksRef: blocks });
            patchWorkStreamUi(workId, {
              streamingBlocks: blocks,
              streamOptimizing: false
            });
          },
          onBodyDelta: (body, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            patchWorkStreamRefs(workId, { streamingBodyRef: body });
            patchWorkStreamUi(workId, {
              streamingBodyText: body,
              streamOptimizing: false
            });
          },
          onStreamReset: (tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            patchWorkStreamUi(workId, { streamOptimizing: true });
          }
        });

      try {
        let result = await runOneStream(outgoingText, effectiveTaskSentence);
        if (result.status === "reply" && baseVersion) {
          const liveForRetry = getStudioWork(workId);
          if (liveForRetry && shouldSuppressStudioCanvasReply(liveForRetry, params.userText)) {
            const retryMessage = wrapManuscriptEditOpinion(params.userText);
            const retryTask = buildStudioReviseTaskSentence(
              composeTask,
              manuscriptCopyAll(baseVersion.blocks, baseVersion.primaryTitleIndex ?? 0),
              retryMessage
            );
            result = await runOneStream(retryMessage, retryTask);
          }
        }

        if (ac.signal.aborted || result.status === "aborted") {
          const live = getStudioWork(workId);
          if (live && runId) {
            const entry = getWorkStreamEntry(workId);
            const streamBlocks = blocksFromComposeStream(
              entry?.streamingBlocksRef ?? null,
              entry?.streamingBodyRef ?? null,
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
            if (ac.signal.aborted || !workStreamAbortMatches(workId, ac)) return;
          }
          const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, outgoingText);
          const failureKind = classifyComposeSoftFailure(result.error, composeTask);
          const entry = getWorkStreamEntry(workId);
          const streamBlocks = blocksFromComposeStream(
            entry?.streamingBlocksRef ?? null,
            entry?.streamingBodyRef ?? null,
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
            patchWorkStreamUi(workId, { agentRouteHint: "", agentSteps: [] });
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
          const entry = getWorkStreamEntry(workId);
          blocks = blocksFromComposeStream(
            entry?.streamingBlocksRef ?? null,
            entry?.streamingBodyRef ?? null,
            []
          );
        }
        if (!blocks.length) {
          finishSoftComposeFailure(after, "needs_brief", params, [], true);
          patchWorkStreamUi(workId, { agentRouteHint: "", agentSteps: [] });
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
                summary: result.tool === "revise" ? "改版提议" : "成稿",
                reason: result.tool === "revise" ? "按你的意见修改" : "",
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
        if (workStreamAbortMatches(workId, ac)) {
          clearStreamingSurface();
          clearWorkStream(workId, ac);
        }
      }
    },
    [workId, isLoggedIn, getAuthHeaders, clearStreamingSurface]
  );

  const runJobExclusive = useCallback(
    async (fn: () => Promise<void>) => {
      if (jobRunningRef.current) {
        abortWorkStream(workId, "stop");
      }
      jobRunningRef.current = true;
      setJobBusy(true);
      try {
        await fn();
      } finally {
        jobRunningRef.current = false;
        setJobBusy(false);
        load();
      }
      return true;
    },
    [load, workId]
  );

  function onManuscriptBlocksChange(blocks: ManuscriptBlock[]) {
    if (!work || !activeVersion || work.status !== "ready") return;
    persist({
      ...work,
      versions: work.versions.map((v) => (v.id === activeVersion.id ? { ...v, blocks } : v))
    });
  }

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
          streamOptimizing={streamOptimizing}
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
          onRestoreCanvasBeforeTurn={restoreCanvasBeforeTurn}
          onCancelStream={cancelAgentStreamStop}
          onUndoApply={undoLastApply}
          selectedSnippet={selectedSnippet}
          onSelectionChange={setSelectedSnippet}
          onRetryLast={retryLast}
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
