"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import {
  deliverableToManuscriptBlocks,
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
import { resolveJobAnchorTurnId } from "../../lib/studioTimeline";
import { streamStudioManuscript } from "../../lib/studioManuscriptStream";
import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type { ManuscriptBlock, StudioWork } from "../../lib/studioWorkTypes";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import StudioAgentDock from "./StudioAgentDock";
import StudioDraftCanvas from "./StudioDraftCanvas";
import StudioSessionRail from "./StudioSessionRail";

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const router = useRouter();
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [selectedPatchKeys, setSelectedPatchKeys] = useState<Set<string>>(new Set());
  const [streamingBlocks, setStreamingBlocks] = useState<ManuscriptBlock[] | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const reviseQueueRef = useRef<string[]>([]);
  const jobRunningRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);

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

  const runStreamManuscript = useCallback(
    async (taskSentence: string, runTool: "generate" | "revise", anchorTool: "generate" | "revise") => {
      const cur = getStudioWork(workId);
      if (!cur || !isLoggedIn) return;

      const intake = buildStudioJobIntake(taskSentence, cur.intake);
      const authorPrompt = buildStudioAuthorPrompt(taskSentenceFromWork(cur) || taskSentence);
      const latest = persist({ ...cur, intake, brief: taskSentenceFromWork(cur) || taskSentence });

      const anchorTurnId = resolveJobAnchorTurnId(latest.agentTurns, anchorTool);
      const { work: withRun, runId } = appendStudioRun(latest, runTool, runTool === "generate" ? "写稿中" : "改版中…", "running", {
        anchorTurnId
      });
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
          runTool === "generate" ? "写稿中" : "改版中…"
        )
      );

      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      setStreamingBlocks([]);

      try {
        const result = await streamStudioManuscript({
          taskSentence,
          intake,
          notebook: latest.binding.notebook,
          noteIds: latest.binding.noteIds,
          featureCore: getComposerPrefsFeatureCore() as unknown as Record<string, unknown>,
          authorPrompt,
          authHeaders: getAuthHeaders(),
          signal: ac.signal,
          onPhase: (msg) => {
            const live = getStudioWork(workId);
            if (!live) return;
            persist(patchStudioGeneratePhase(live, runId, msg));
          },
          onBlocks: (blocks) => setStreamingBlocks(blocks)
        });

        const after = getStudioWork(workId);
        if (!after) return;
        if (result.status !== "done") {
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
              result.error ?? "生成失败"
            )
          );
          return;
        }

        const blocks = deliverableToManuscriptBlocks(result.deliverable);
        const bodyText = blocks.find((b) => b.kind === "body")?.text ?? "";
        if (!blocks.length || deliverableBodyLooksLikeIntakeEcho(bodyText)) {
          persist(
            finishStudioRun(
              {
                ...after,
                status: runTool === "generate" ? "draft" : "ready",
                error:
                  "成稿像是通用模板，缺少具体卖点。请补充受众、产品卖点、使用场景后重试。",
                runPhase: undefined
              },
              runId,
              "error",
              "成稿校验失败"
            )
          );
          return;
        }

        if (runTool === "revise") {
          const base =
            after.versions.find((v) => v.id === after.activeVersionId) ?? after.versions.at(-1);
          if (!base) {
            persist(finishStudioRun({ ...after, status: "ready", runPhase: undefined }, runId, "error", "无基准版本"));
            return;
          }
          const keys = diffBlockKeys(base.blocks, blocks);
          const merged = mergeBlocks(base.blocks, blocks, keys);
          const versionId = crypto.randomUUID();
          persist(
            finishStudioRun(
              {
                ...after,
                status: "ready",
                versions: [
                  ...after.versions,
                  {
                    id: versionId,
                    label: nextVersionLabel(after.versions),
                    createdAt: Date.now(),
                    blocks: merged,
                    sourceRunId: runId
                  }
                ],
                activeVersionId: versionId,
                pendingPatch: undefined,
                runPhase: undefined,
                error: undefined
              },
              runId,
              "done",
              `改版已应用 · ${keys.size} 处变更`
            )
          );
          return;
        }

        const versionId = crypto.randomUUID();
        const version = {
          id: versionId,
          label: nextVersionLabel(after.versions),
          createdAt: Date.now(),
          blocks,
          primaryTitleIndex: 0,
          sourceRunId: runId
        };
        persist(
          finishStudioRun(
            {
              ...after,
              status: "ready",
              plan: undefined,
              intake,
              versions: [...after.versions, version],
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
        if (failed) {
          persist(
            finishStudioRun(
              { ...failed, status: runTool === "generate" ? "draft" : "ready", error: msg, runPhase: undefined },
              runId,
              "error",
              msg
            )
          );
        }
      } finally {
        setStreamingBlocks(null);
        if (streamAbortRef.current === ac) streamAbortRef.current = null;
      }
    },
    [workId, isLoggedIn, getAuthHeaders]
  );

  const runConfirmGenerate = useCallback(async () => {
    const cur = getStudioWork(workId);
    if (!cur || !isLoggedIn) return;
    const taskSentence = taskSentenceFromWork(cur);
    if (!taskSentence.trim()) return;
    await runStreamManuscript(taskSentence, "generate", "generate");
  }, [workId, isLoggedIn, runStreamManuscript]);

  const runReviseJob = useCallback(
    async (opinion: string) => {
      const latest = getStudioWork(workId) ?? work;
      if (!latest || !isLoggedIn) return;
      const base =
        latest.versions.find((v) => v.id === latest.activeVersionId) ?? latest.versions.at(-1);
      if (!base) return;

      const baseTask = taskSentenceFromWork(latest);
      const patchOpinion = buildBlockPatchOpinion(opinion);
      const manuscriptPlain = manuscriptCopyAll(base.blocks, base.primaryTitleIndex ?? 0);
      const taskSentence = buildStudioReviseTaskSentence(baseTask, manuscriptPlain, patchOpinion);
      await runStreamManuscript(taskSentence, "revise", "revise");
    },
    [workId, work, isLoggedIn, runStreamManuscript]
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

  async function onGenerate() {
    await runJobExclusive(runConfirmGenerate);
  }

  async function onReviseFromChat(opinion: string) {
    await runJobExclusive(() => runReviseJob(opinion));
  }

  function onQueueRevise(opinion: string) {
    const text = opinion.trim();
    if (!text) return;
    reviseQueueRef.current.push(text);
  }

  function onApplyPatch(partial: boolean) {
    if (!work?.pendingPatch || !activeVersion) return;
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
        <div className="min-h-0 flex-1 overflow-hidden px-2 py-2 sm:px-3">
          <StudioDraftCanvas
            work={work}
            busy={jobBusy}
            activeVersion={activeVersion ?? null}
            versions={work.versions}
            streamingBlocks={streamingBlocks}
            showFeatureNudge={showFeatureNudge}
            onFillFeature={() => {
              markOpenComposerFeature();
              router.push(WORKBENCH_CHAT_PATH);
            }}
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

        <div className="max-h-[min(38vh,300px)] min-h-[168px] shrink-0 border-t border-line">
          <StudioAgentDock
            work={work}
            isLoggedIn={isLoggedIn}
            ready={ready}
            jobBusy={jobBusy}
            canvasMode
            getAuthHeaders={getAuthHeaders}
            onPersist={persist}
            onGenerate={() => void onGenerate()}
            onReviseFromChat={(opinion) => void onReviseFromChat(opinion)}
            onQueueRevise={onQueueRevise}
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
      </div>
    </main>
  );
}
