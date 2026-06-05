"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { deliverableToManuscriptBlocks, diffBlockKeys, mergeBlocks, nextVersionLabel } from "../../lib/studioDeliverable";
import { deliverableBodyLooksLikeIntakeEcho } from "../../lib/studioDeliverableQuality";
import { runComposerExpertDeliverableJob } from "../../lib/homeComposerExpertJob";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { buildBlockPatchOpinion } from "../../lib/studioBlockPatch";
import { buildStudioAuthorPrompt, buildStudioJobIntake } from "../../lib/studioWorkIntake";
import { getComposerPrefsFeatureCore, getStudioWork, upsertStudioWork } from "../../lib/studioWorkStorage";
import {
  appendStudioRun,
  finishStudioRun,
  patchStudioGeneratePhase
} from "../../lib/studioOrchestrator";
import { taskSentenceFromWork } from "../../lib/studioWorkTask";
import type { StudioWork } from "../../lib/studioWorkTypes";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import StudioAgentDock from "./StudioAgentDock";
import StudioSessionRail from "./StudioSessionRail";

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [selectedPatchKeys, setSelectedPatchKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const load = useCallback(() => {
    const w = getStudioWork(workId);
    setWork(w);
    return w;
  }, [workId]);

  useEffect(() => {
    load();
  }, [load]);

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

  const runConfirmGenerate = useCallback(async () => {
    const cur = getStudioWork(workId);
    if (!cur || !isLoggedIn) return;
    const taskSentence = taskSentenceFromWork(cur);
    if (!taskSentence.trim()) return;

    const intake = buildStudioJobIntake(taskSentence, cur.intake);
    const authorPrompt = buildStudioAuthorPrompt(taskSentence);
    const latest = persist({ ...cur, intake, brief: taskSentence });

    const { work: withRun, runId } = appendStudioRun(latest, "generate", "写稿中");
    persist(
      patchStudioGeneratePhase(
        {
          ...withRun,
          status: "generating",
          plan: undefined,
          error: undefined,
          allowModelFallback: true
        },
        runId,
        "写稿中"
      )
    );

    try {
      const result = await runComposerExpertDeliverableJob({
        expertId: "xhs_ops",
        taskSentence,
        intake,
        notebook: latest.binding.notebook,
        noteIds: latest.binding.noteIds,
        featureCore: getComposerPrefsFeatureCore(),
        authorPrompt,
        authHeaders: getAuthHeaders(),
        createdBy: user?.phone,
        onProgress: (msg) => {
          const live = getStudioWork(workId);
          if (!live) return;
          persist(patchStudioGeneratePhase(live, runId, msg));
        }
      });

      const after = getStudioWork(workId);
      if (!after) return;
      if (result.status !== "done") {
        persist(
          finishStudioRun(
            { ...after, status: "draft", error: result.error, runPhase: undefined },
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
              status: "draft",
              error: "成稿内容异常（疑似偏好标签回显），请重试或补充产品卖点",
              runPhase: undefined
            },
            runId,
            "error",
            "成稿校验失败"
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
        jobId: result.jobId,
        primaryTitleIndex: 0
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
            lastJobId: result.jobId,
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
      const failed = getStudioWork(workId);
      const msg = String(err instanceof Error ? err.message : err);
      if (failed) {
        persist(
          finishStudioRun(
            { ...failed, status: "draft", error: msg, runPhase: undefined },
            runId,
            "error",
            msg
          )
        );
      }
    }
  }, [workId, isLoggedIn, getAuthHeaders, user?.phone]);

  async function onGenerate() {
    setBusy(true);
    try {
      await runConfirmGenerate();
    } finally {
      setBusy(false);
      load();
    }
  }

  async function onReviseFromChat(opinion: string) {
    const latest = getStudioWork(workId) ?? work;
    if (!latest || !isLoggedIn) return;
    const base = latest.versions.find((v) => v.id === latest.activeVersionId) ?? latest.versions.at(-1);
    if (!base) return;

    setBusy(true);
    const baseTask = taskSentenceFromWork(latest);
    const taskSentence = `${baseTask}\n\n改版意见：${buildBlockPatchOpinion(opinion)}`;
    const { work: withRun, runId } = appendStudioRun(latest, "revise", "改版中…");
    persist(
      patchStudioGeneratePhase(
        { ...withRun, status: "generating", error: undefined },
        runId,
        "改版中…"
      )
    );

    try {
      const result = await runComposerExpertDeliverableJob({
        expertId: "xhs_ops",
        taskSentence,
        intake: latest.intake,
        notebook: latest.binding.notebook,
        noteIds: latest.binding.noteIds,
        featureCore: getComposerPrefsFeatureCore(),
        authHeaders: getAuthHeaders(),
        createdBy: user?.phone,
        onProgress: (msg) => {
          const live = getStudioWork(workId);
          if (!live) return;
          persist(patchStudioGeneratePhase(live, runId, msg));
        }
      });

      const cur = getStudioWork(workId);
      if (!cur || result.status !== "done") {
        if (cur) {
          const err = result.status === "error" ? result.error : "改版失败";
          persist(finishStudioRun({ ...cur, status: "ready", error: err }, runId, "error", err));
        }
        return;
      }

      const proposed = deliverableToManuscriptBlocks(result.deliverable);
      const keys = diffBlockKeys(base.blocks, proposed);
      persist(
        finishStudioRun(
          {
            ...cur,
            status: "ready",
            pendingPatch: {
              fromVersionId: base.id,
              proposedBlocks: proposed,
              summary: `${keys.size} 处块有变更`
            },
            runPhase: undefined,
            error: undefined,
            lastOrchestratorNote: undefined
          },
          runId,
          "done",
          `改版提议 · ${keys.size} 处变更`
        )
      );
    } finally {
      setBusy(false);
    }
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
          blocks: merged
        }
      ],
      activeVersionId: versionId,
      pendingPatch: undefined
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
          parentBusy={busy}
          getAuthHeaders={getAuthHeaders}
          onPersist={persist}
          onGenerate={() => void onGenerate()}
          onReviseFromChat={(opinion) => void onReviseFromChat(opinion)}
          activeVersion={activeVersion ?? null}
          showFeatureNudge={showFeatureNudge}
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
          onWowRevise={(opinion) => void onReviseFromChat(opinion)}
        />
      </div>
    </main>
  );
}
