"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import {
  diffBlockKeys,
  mergeBlocks,
  manuscriptCopyAll,
  nextVersionLabel
} from "../../lib/studioDeliverable";
import { deliverableBodyLooksLikeIntakeEcho } from "../../lib/studioDeliverableQuality";
import { WORKBENCH_CHAT_PATH, WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { markOpenComposerFeature } from "../../lib/studioComposerFeatureLink";
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
import { streamStudioAgent } from "../../lib/studioAgentStream";
import { studioAgentRouteHint } from "../../lib/studioAgentToolSchema";
import { upsertAgentStep, type StudioAgentStep } from "../../lib/studioAgentSteps";
import { STUDIO_ACK_GENERATE, STUDIO_ACK_REVISE } from "../../lib/studioTimeline";
import { composeTaskSentenceFromTurns, taskSentenceFromWork } from "../../lib/studioWorkTask";
import type {
  ManuscriptBlock,
  ManuscriptVersion,
  PendingPatch,
  StudioAgentTurn,
  StudioWork,
  WorkStatus
} from "../../lib/studioWorkTypes";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import StudioAgentDock from "./StudioAgentDock";
import StudioSessionRail from "./StudioSessionRail";

type CanvasSnapshot = {
  versions: ManuscriptVersion[];
  activeVersionId: string;
  pendingPatch?: PendingPatch;
  status: WorkStatus;
};

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const router = useRouter();
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [selectedPatchKeys, setSelectedPatchKeys] = useState<Set<string>>(new Set());
  const [streamingBlocks, setStreamingBlocks] = useState<ManuscriptBlock[] | null>(null);
  const [streamingBodyText, setStreamingBodyText] = useState<string | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const reviseQueueRef = useRef<string[]>([]);
  const jobRunningRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const canvasSnapshotsRef = useRef<Map<string, CanvasSnapshot>>(new Map());
  const undoStackRef = useRef<ManuscriptBlock[][]>([]);
  const [canUndoPatch, setCanUndoPatch] = useState(false);
  const [agentRouteHint, setAgentRouteHint] = useState("");
  const [agentSteps, setAgentSteps] = useState<StudioAgentStep[]>([]);

  const load = useCallback(() => {
    const w = getStudioWork(workId);
    setWork(w);
    return w;
  }, [workId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => streamAbortRef.current?.abort(), []);

  const activeVersion = useMemo(
    () => work?.versions.find((v) => v.id === work.activeVersionId) ?? work?.versions[work?.versions.length - 1],
    [work]
  );

  const changedKeys = useMemo(() => {
    if (!work?.pendingPatch || !activeVersion) return new Set<string>();
    return diffBlockKeys(activeVersion.blocks, work.pendingPatch.proposedBlocks);
  }, [work, activeVersion]);

  useEffect(() => {
    if (!work?.pendingPatch) return;
    setSelectedPatchKeys(new Set(changedKeys));
  }, [work?.pendingPatch, changedKeys]);

  const showFeatureNudge = useMemo(() => {
    if (!work) return false;
    if (work.featureNudgeDismissed) return false;
    if (work.versions.length === 0) return false;
    if (work.status !== "ready" && work.status !== "shipped") return false;
    return !isFeatureCoreComplete(getComposerPrefsFeatureCore());
  }, [work]);

  function persist(next: StudioWork): StudioWork {
    const saved = upsertStudioWork({ ...next, allowModelFallback: true });
    setWork(saved);
    return saved;
  }

  const cancelAgentStream = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const restoreCanvasBeforeTurn = useCallback(
    (turnId: string) => {
      const snap = canvasSnapshotsRef.current.get(turnId);
      const cur = getStudioWork(workId);
      if (!snap || !cur) return;
      persist({
        ...cur,
        versions: snap.versions,
        activeVersionId: snap.activeVersionId,
        pendingPatch: snap.pendingPatch,
        status: snap.status,
        error: undefined,
        runPhase: undefined
      });
      setStreamingBlocks(null);
      setStreamingBodyText(null);
    },
    [workId]
  );

  const clearStreamingSurface = useCallback(() => {
    setStreamingBlocks(null);
    setStreamingBodyText(null);
  }, []);

  const runAgentStream = useCallback(
    async (params: {
      userText: string;
      prefixTurns: StudioAgentTurn[];
      userTurnId: string;
    }) => {
      const cur = getStudioWork(workId);
      if (!cur || !isLoggedIn) return;

      canvasSnapshotsRef.current.set(params.userTurnId, {
        versions: cur.versions,
        activeVersionId: cur.activeVersionId,
        pendingPatch: cur.pendingPatch,
        status: cur.status
      });

      const composeTask = composeTaskSentenceFromTurns(params.prefixTurns, params.userText);
      const intake = buildStudioJobIntake(composeTask, cur.intake);
      const authorPrompt = buildStudioAuthorPrompt(composeTask);

      const baseVersion =
        cur.versions.find((v) => v.id === cur.activeVersionId) ?? cur.versions.at(-1);
      const isReviseIntent =
        Boolean(baseVersion) &&
        /改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化/.test(
          params.userText
        );
      const effectiveTaskSentence =
        isReviseIntent && baseVersion
          ? buildStudioReviseTaskSentence(
              composeTask,
              manuscriptCopyAll(baseVersion.blocks, baseVersion.primaryTitleIndex ?? 0),
              params.userText
            )
          : composeTask;

      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      setAgentRouteHint("");
      setAgentSteps([]);

      let runId = "";
      let runTool: "generate" | "revise" = "generate";
      let ackAppended = false;

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
          createdAt: Date.now()
        };
        const ackTurns = [...params.prefixTurns, ackTurn];
        const { work: withRun, runId: rid } = appendStudioRun(live, tool, tool === "generate" ? "写稿中" : "改版中…", "running", {
          anchorTurnId: ackTurn.id
        });
        runId = rid;
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
      };

      const manuscriptBlocks = baseVersion?.blocks ?? [];

      try {
        const result = await streamStudioAgent({
          message: params.userText,
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
          authHeaders: getAuthHeaders(),
          signal: ac.signal,
          onStep: (step) => setAgentSteps((prev) => upsertAgentStep(prev, step)),
          onRoute: (route) => setAgentRouteHint(studioAgentRouteHint(route, "write")),
          onReply: (text) => {
            const live = getStudioWork(workId);
            if (!live) return;
            const assistantTurn: StudioAgentTurn = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: text,
              createdAt: Date.now()
            };
            persist({
              ...live,
              agentTurns: [...params.prefixTurns, assistantTurn],
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
            setStreamingBlocks(blocks);
          },
          onBodyDelta: (body, tool) => {
            ensureComposeRun(tool === "revise" ? "revise" : "generate");
            setStreamingBodyText(body);
          }
        });

        if (ac.signal.aborted || result.status === "aborted") {
          const live = getStudioWork(workId);
          if (live && runId) {
            persist(
              finishStudioRun(
                {
                  ...live,
                  status: runTool === "generate" ? "draft" : live.versions.length ? "ready" : "draft",
                  runPhase: undefined,
                  error: undefined
                },
                runId,
                "error",
                "已取消"
              )
            );
          }
          return;
        }

        const after = getStudioWork(workId);
        if (!after) return;

        if (result.status === "reply") {
          return;
        }

        if (result.status === "error") {
          if (runId) {
            persist(
              finishStudioRun(
                {
                  ...after,
                  status: runTool === "generate" ? "draft" : "ready",
                  error: result.error,
                  runPhase: undefined
                },
                runId,
                "error",
                result.error
              )
            );
          } else {
            persist({ ...after, error: result.error });
          }
          return;
        }

        const blocks = result.blocks;
        const bodyText = blocks.find((b) => b.kind === "body")?.text ?? "";
        if (!blocks.length || deliverableBodyLooksLikeIntakeEcho(bodyText)) {
          persist(
            finishStudioRun(
              {
                ...after,
                status: runTool === "generate" ? "draft" : "ready",
                error: "成稿像是通用模板，请补充受众、卖点与使用场景后重试。",
                runPhase: undefined
              },
              runId,
              "error",
              "成稿校验失败"
            )
          );
          return;
        }

        if (result.tool === "revise") {
          const base =
            after.versions.find((v) => v.id === after.activeVersionId) ?? after.versions.at(-1);
          if (!base) {
            persist(finishStudioRun({ ...after, status: "ready", runPhase: undefined }, runId, "error", "无基准版本"));
            return;
          }
          const keys = diffBlockKeys(base.blocks, blocks);
          persist(
            finishStudioRun(
              {
                ...after,
                status: "ready",
                pendingPatch: {
                  fromVersionId: base.id,
                  proposedBlocks: blocks,
                  summary: `改版待确认 · ${keys.size} 处变更`,
                  sourceRunId: runId
                },
                runPhase: undefined,
                error: undefined
              },
              runId,
              "done",
              `改版待确认 · ${keys.size} 处变更`
            )
          );
          return;
        }

        const versionId = crypto.randomUUID();
        persist(
          finishStudioRun(
            {
              ...after,
              status: "ready",
              plan: undefined,
              intake,
              versions: [
                ...after.versions,
                {
                  id: versionId,
                  label: nextVersionLabel(after.versions),
                  createdAt: Date.now(),
                  blocks,
                  primaryTitleIndex: 0,
                  sourceRunId: runId
                }
              ],
              activeVersionId: versionId,
              pendingPatch: undefined,
              runPhase: undefined,
              error: undefined,
              lastOrchestratorNote: undefined
            },
            runId,
            "done",
            "稿件已生成"
          )
        );
      } catch (err) {
        if (ac.signal.aborted) return;
        const failed = getStudioWork(workId);
        const msg = String(err instanceof Error ? err.message : err);
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
        clearStreamingSurface();
        setAgentRouteHint("");
        setAgentSteps([]);
        if (streamAbortRef.current === ac) streamAbortRef.current = null;
      }
    },
    [workId, isLoggedIn, getAuthHeaders]
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
        const queued = reviseQueueRef.current.shift();
        if (queued) {
          void runJobExclusive(() => runReviseJob(queued));
        }
      }
      return true;
    },
    [load, runReviseJob]
  );

  async function onReviseFromChat(opinion: string) {
    await runJobExclusive(() => runReviseJob(opinion));
  }

  function onUndoPatch() {
    const prev = undoStackRef.current.pop();
    if (!prev || !work || !activeVersion) return;
    persist({
      ...work,
      versions: work.versions.map((v) =>
        v.id === activeVersion.id ? { ...v, blocks: prev } : v
      ),
      pendingPatch: undefined
    });
    setCanUndoPatch(undoStackRef.current.length > 0);
  }

  function onQueueRevise(opinion: string) {
    const text = opinion.trim();
    if (!text) return;
    reviseQueueRef.current.push(text);
  }

  function cloneBlocks(blocks: ManuscriptBlock[]): ManuscriptBlock[] {
    return blocks.map((b) => (b.kind === "hashtags" ? { ...b, tags: [...b.tags] } : { ...b }));
  }

  function onApplyPatch(partial: boolean) {
    if (!work?.pendingPatch || !activeVersion) return;
    undoStackRef.current.push(cloneBlocks(activeVersion.blocks));
    setCanUndoPatch(true);
    const keys = partial ? selectedPatchKeys : changedKeys;
    const merged = mergeBlocks(activeVersion.blocks, work.pendingPatch.proposedBlocks, keys);
    const versionId = crypto.randomUUID();
    persist({
      ...work,
      versions: [
        ...work.versions,
        {
          id: versionId,
          label: nextVersionLabel(work.versions),
          createdAt: Date.now(),
          blocks: merged,
          sourceRunId: work.pendingPatch?.sourceRunId
        }
      ],
      activeVersionId: versionId,
      pendingPatch: undefined
    });
  }

  function onManuscriptBlocksChange(blocks: ManuscriptBlock[]) {
    if (!work || !activeVersion || work.status !== "ready" || work.pendingPatch) return;
    persist({
      ...work,
      versions: work.versions.map((v) => (v.id === activeVersion.id ? { ...v, blocks } : v))
    });
  }

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
          getAuthHeaders={getAuthHeaders}
          onPersist={persist}
          onAgentRun={async ({ userText, prefixTurns, userTurnId }) => {
            await runJobExclusive(() =>
              runAgentStream({ userText, prefixTurns, userTurnId })
            );
          }}
          onQueueRevise={onQueueRevise}
          onRestoreCanvasBeforeTurn={restoreCanvasBeforeTurn}
          onCancelStream={cancelAgentStream}
          hasPendingPatch={Boolean(work.pendingPatch)}
          onAcceptPatch={() => onApplyPatch(false)}
          onUndoPatch={onUndoPatch}
          canUndoPatch={canUndoPatch}
          activeVersion={activeVersion ?? null}
          showFeatureNudge={false}
          onDismissFeatureNudge={() => persist({ ...work, featureNudgeDismissed: true })}
          onApplyPatch={onApplyPatch}
          onDiscardPatch={() => persist({ ...work, pendingPatch: undefined })}
          selectedPatchKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onTogglePatchKey={(key) => {
            setSelectedPatchKeys((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
          onTitleIndexChange={(index) => {
            if (!work || !activeVersion) return;
            persist({
              ...work,
              versions: work.versions.map((v) =>
                v.id === activeVersion.id ? { ...v, primaryTitleIndex: index } : v
              )
            });
          }}
          onVersionChange={(versionId) => {
            if (!work.versions.some((v) => v.id === versionId)) return;
            persist({ ...work, activeVersionId: versionId, pendingPatch: undefined });
          }}
          onBlocksChange={onManuscriptBlocksChange}
          onSelectionRevise={(selectedText, opinion) =>
            void onReviseFromChat(buildSelectionPatchOpinion(selectedText, opinion))
          }
          onWowRevise={(opinion) => void onReviseFromChat(opinion)}
        />
      </div>
    </main>
  );
}
