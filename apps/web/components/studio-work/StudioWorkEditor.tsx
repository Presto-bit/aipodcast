"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { deliverableToManuscriptBlocks, diffBlockKeys, mergeBlocks, nextVersionLabel } from "../../lib/studioDeliverable";
import { mergeBriefIntoWork } from "../../lib/studioAgentAsk";
import { runComposerExpertDeliverableJob } from "../../lib/homeComposerExpertJob";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { buildPlanForWork } from "../../lib/studioWorkPlan";
import { getStudioWork, patchStudioWork, upsertStudioWork } from "../../lib/studioWorkStorage";
import type { StudioWork } from "../../lib/studioWorkTypes";
import StudioAgentDock from "./StudioAgentDock";
import StudioSessionRail from "./StudioSessionRail";

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [reviseText, setReviseText] = useState("");
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

  function persist(next: StudioWork) {
    upsertStudioWork({ ...next, allowModelFallback: true });
    setWork(next);
  }

  async function onGeneratePlan() {
    if (!work || !isLoggedIn) return;
    setBusy(true);
    try {
      const synced = mergeBriefIntoWork(work, work.agentTurns ?? []) ?? work;
      const { work: planned } = await buildPlanForWork(
        { ...synced, brief: synced.brief.trim(), allowModelFallback: true },
        getAuthHeaders()
      );
      persist(planned);
    } catch (err) {
      persist({ ...work, error: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmGenerate() {
    if (!work || !isLoggedIn) return;
    setBusy(true);
    persist({
      ...work,
      status: "generating",
      runPhase: "排队中…",
      error: undefined,
      allowModelFallback: true
    });
    const taskSentence = work.brief.trim();
    try {
      const result = await runComposerExpertDeliverableJob({
        expertId: "xhs_ops",
        taskSentence,
        intake: work.intake,
        notebook: work.binding.notebook,
        noteIds: work.binding.noteIds,
        featureCore: work.featureCore,
        authHeaders: getAuthHeaders(),
        createdBy: user?.phone,
        onProgress: (msg) => {
          const cur = getStudioWork(workId);
          if (cur) patchStudioWork(workId, { runPhase: msg });
          setWork((w) => (w ? { ...w, runPhase: msg } : w));
        }
      });
      const cur = getStudioWork(workId);
      if (!cur) return;
      if (result.status !== "done") {
        persist({ ...cur, status: "planned", error: result.error, runPhase: undefined });
        return;
      }
      const blocks = deliverableToManuscriptBlocks(result.deliverable);
      const versionId = crypto.randomUUID();
      const version = {
        id: versionId,
        label: nextVersionLabel(cur.versions),
        createdAt: Date.now(),
        blocks,
        jobId: result.jobId
      };
      persist({
        ...cur,
        status: "ready",
        versions: [...cur.versions, version],
        activeVersionId: versionId,
        lastJobId: result.jobId,
        pendingPatch: undefined,
        runPhase: undefined,
        error: undefined
      });
    } catch (err) {
      const cur = getStudioWork(workId);
      if (cur) persist({ ...cur, status: "planned", error: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRevise() {
    if (!work || !isLoggedIn || !reviseText.trim()) return;
    const base = activeVersion;
    if (!base) return;
    setBusy(true);
    const taskSentence = `${work.brief.trim()}\n\n改版意见：${reviseText.trim()}`;
    persist({ ...work, status: "generating", runPhase: "改版生成中…", error: undefined });
    try {
      const result = await runComposerExpertDeliverableJob({
        expertId: "xhs_ops",
        taskSentence,
        intake: work.intake,
        notebook: work.binding.notebook,
        noteIds: work.binding.noteIds,
        featureCore: work.featureCore,
        authHeaders: getAuthHeaders(),
        createdBy: user?.phone,
        onProgress: (msg) => patchStudioWork(workId, { runPhase: msg })
      });
      const cur = getStudioWork(workId);
      if (!cur || result.status !== "done") {
        if (cur) {
          const err = result.status === "error" ? result.error : "改版失败";
          persist({ ...cur, status: "ready", error: err });
        }
        return;
      }
      const proposed = deliverableToManuscriptBlocks(result.deliverable);
      const keys = diffBlockKeys(base.blocks, proposed);
      persist({
        ...cur,
        status: "ready",
        pendingPatch: { fromVersionId: base.id, proposedBlocks: proposed, summary: `${keys.size} 处块有变更` },
        runPhase: undefined,
        error: undefined
      });
      setReviseText("");
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
          onGeneratePlan={() => onGeneratePlan()}
          onConfirmGenerate={() => void onConfirmGenerate()}
          activeVersion={activeVersion ?? null}
          reviseText={reviseText}
          onReviseTextChange={setReviseText}
          onRevise={() => void onRevise()}
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
          onMarkShipped={() => persist({ ...work, status: "shipped" })}
        />
      </div>
    </main>
  );
}
