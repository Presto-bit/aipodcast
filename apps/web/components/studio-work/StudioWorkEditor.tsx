"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { deliverableToManuscriptBlocks, diffBlockKeys, mergeBlocks, nextVersionLabel } from "../../lib/studioDeliverable";
import { useNotebooksHubQuery } from "../../lib/queries/notebooksQueries";
import { runComposerExpertDeliverableJob } from "../../lib/homeComposerExpertJob";
import { voiceProgressLabel } from "../../lib/studioVoiceFromChat";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { buildPlanForWork } from "../../lib/studioWorkPlan";
import { getStudioWork, patchStudioWork, upsertStudioWork } from "../../lib/studioWorkStorage";
import type { ManuscriptBlock, StudioWork } from "../../lib/studioWorkTypes";
import { workStatusLabel } from "../../lib/studioWorkTypes";
import StudioAgentDock from "./StudioAgentDock";
import StudioManuscriptPanel from "./StudioManuscriptPanel";

async function fetchNotebookNoteIds(
  notebook: string,
  headers: Record<string, string>
): Promise<string[]> {
  const q = new URLSearchParams({ notebook, limit: "500" });
  const res = await fetch(`/api/notes?${q}`, { credentials: "same-origin", headers });
  const data = (await res.json().catch(() => ({}))) as { notes?: { noteId?: string }[] };
  if (!res.ok) return [];
  return (data.notes || []).map((n) => String(n.noteId || "").trim()).filter(Boolean);
}

export default function StudioWorkEditor({ workId }: { workId: string }) {
  const { ready, user, getAuthHeaders } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const [work, setWork] = useState<StudioWork | null>(null);
  const [tab, setTab] = useState<"manuscript" | "ship">("manuscript");
  const [reviseText, setReviseText] = useState("");
  const [selectedPatchKeys, setSelectedPatchKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"manuscript" | "corpus">("manuscript");
  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready);

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
    upsertStudioWork(next);
    setWork(next);
  }

  async function onGeneratePlan() {
    if (!work || !isLoggedIn) return;
    setBusy(true);
    try {
      const { work: planned } = await buildPlanForWork(
        { ...work, brief: work.brief.trim() },
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
    if (work.binding.noteIds.length === 0 && !work.allowModelFallback) {
      persist({ ...work, error: "请绑定资料或勾选允许通识兜底" });
      return;
    }
    setBusy(true);
    persist({
      ...work,
      status: "generating",
      runPhase: "排队中…",
      error: undefined
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
      const summary = `${keys.size} 处块有变更`;
      persist({
        ...cur,
        status: "ready",
        pendingPatch: { fromVersionId: base.id, proposedBlocks: proposed, summary },
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
    const version = {
      id: versionId,
      label: nextVersionLabel(work.versions),
      createdAt: Date.now(),
      blocks: merged
    };
    persist({
      ...work,
      versions: [...work.versions, version],
      activeVersionId: versionId,
      pendingPatch: undefined
    });
  }

  if (!work) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center text-sm text-muted">
        任务不存在或已删除 ·{" "}
        <Link href={WORKBENCH_STUDIO_PATH} className="text-brand">
          返回列表
        </Link>
      </main>
    );
  }

  const showPlan = work.status === "planned" || (work.status === "briefing" && work.plan);
  const readOnly = work.status === "generating";

  return (
    <main className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur-sm sm:px-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={WORKBENCH_STUDIO_PATH} className="text-muted hover:text-brand">
            ← 创作
          </Link>
          <span className="font-medium text-ink">{work.title}</span>
          <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">
            {workStatusLabel(work.status)}
          </span>
          {activeVersion ? (
            <span className="text-[11px] text-muted">{activeVersion.label}</span>
          ) : null}
          {work.brief.trim() ? (
            <span className="hidden max-w-[12rem] truncate text-[11px] text-muted sm:inline" title={work.brief}>
              {work.brief}
            </span>
          ) : null}
          <span className="text-[11px] text-muted lg:hidden">
            料{work.binding.noteIds.length || "0"}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {work.status === "briefing" || work.status === "planned" ? (
              <button
                type="button"
                disabled={busy || !work.brief.trim()}
                className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-fill disabled:opacity-50"
                onClick={() => void onGeneratePlan()}
              >
                生成计划
              </button>
            ) : null}
            {work.status === "planned" ? (
              <button
                type="button"
                disabled={busy || !isLoggedIn}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
                onClick={() => void onConfirmGenerate()}
              >
                确认生成
              </button>
            ) : null}
            {work.status === "ready" ? (
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-fill"
                onClick={() => persist({ ...work, status: "shipped" })}
              >
                标记已发布
              </button>
            ) : null}
          </div>
        </div>
        {work.runPhase ? <p className="mt-1 text-xs text-brand">{work.runPhase}</p> : null}
        {work.error ? <p className="mt-1 text-xs text-danger-ink">{work.error}</p> : null}
      </header>

      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-1.5 lg:hidden">
        {(
          [
            ["manuscript", "创作"],
            ["corpus", "资料"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              mobilePanel === id ? "bg-brand/10 text-brand" : "text-muted"
            ].join(" ")}
            onClick={() => setMobilePanel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={[
            "w-full shrink-0 border-r border-line bg-fill/15 p-2.5 lg:block lg:w-48",
            mobilePanel === "corpus" ? "block" : "hidden lg:block"
          ].join(" ")}
        >
          <p className="text-xs font-medium text-ink">资料</p>
          <label className="mt-2 block text-[11px] text-muted">
            笔记本
            <select
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
              value={work.binding.notebook}
              onChange={(e) => {
                const nb = e.target.value;
                persist({ ...work, binding: { notebook: nb, noteIds: [] } });
              }}
            >
              <option value="">未选择</option>
              {(notebooksQuery.data?.notebooks || []).map((nb) => (
                <option key={nb} value={nb}>
                  {nb}
                </option>
              ))}
            </select>
          </label>
          {work.binding.notebook ? (
            <button
              type="button"
              disabled={notesBusy}
              className="mt-2 w-full rounded-lg border border-line py-1.5 text-[11px] hover:bg-fill disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setNotesBusy(true);
                  try {
                    const ids = await fetchNotebookNoteIds(work.binding.notebook, getAuthHeaders());
                    persist({ ...work, binding: { ...work.binding, noteIds: ids } });
                  } finally {
                    setNotesBusy(false);
                  }
                })();
              }}
            >
              {notesBusy ? "加载中…" : `载入全部已索引（${work.binding.noteIds.length} 篇）`}
            </button>
          ) : null}
          <label className="mt-3 flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={work.allowModelFallback}
              onChange={(e) => persist({ ...work, allowModelFallback: e.target.checked })}
            />
            允许通识兜底
          </label>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            {voiceProgressLabel(work.featureCore)} · 在底部 Agent 对话中自动收集，无需填表
          </p>
        </aside>

        <section
          className={[
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobilePanel === "manuscript" ? "flex" : "hidden lg:flex"
          ].join(" ")}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
          {showPlan && work.plan ? (
            <div className="mb-2 rounded-lg border border-brand/25 bg-brand/5 px-2.5 py-2 text-[11px]">
              <p className="font-medium text-ink">{work.plan.goal}</p>
              {work.plan.risks.length ? (
                <p className="mt-1 text-warning-ink">{work.plan.risks.join(" · ")}</p>
              ) : null}
            </div>
          ) : null}

          {!work.brief.trim() && (work.status === "briefing" || work.status === "planned") && !work.plan ? (
            <p className="mb-2 text-[11px] text-muted">
              在底部 Agent 描述需求；Voice 三问会在对话里追问。收敛后点「写入 Brief」→「生成计划」。
            </p>
          ) : null}

          <StudioManuscriptPanel
            tab={tab}
            onTabChange={setTab}
            version={activeVersion ?? null}
            compareBlocks={work.pendingPatch?.proposedBlocks}
            compareMode={Boolean(work.pendingPatch)}
            selectedKeys={selectedPatchKeys}
            changedKeys={changedKeys}
            onToggleKey={(key) => {
              setSelectedPatchKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            shipChecks={work.shipChecks}
            onShipCheck={(id, v) => persist({ ...work, shipChecks: { ...work.shipChecks, [id]: v } })}
            readOnly={readOnly}
          />

          {work.pendingPatch ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2 py-1.5 text-[11px]">
              <span className="text-ink">{work.pendingPatch.summary}</span>
              <button
                type="button"
                className="rounded bg-brand px-2 py-0.5 text-brand-foreground"
                onClick={() => onApplyPatch(true)}
              >
                采纳({selectedPatchKeys.size})
              </button>
              <button type="button" className="rounded border border-line px-2 py-0.5" onClick={() => onApplyPatch(false)}>
                全采纳
              </button>
              <button
                type="button"
                className="text-muted"
                onClick={() => persist({ ...work, pendingPatch: undefined })}
              >
                放弃
              </button>
            </div>
          ) : null}

          {work.status === "ready" && !work.pendingPatch ? (
            <div className="mt-2 flex gap-1.5">
              <input
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px]"
                value={reviseText}
                onChange={(e) => setReviseText(e.target.value)}
                placeholder={`改版 ${activeVersion?.label || ""}：标题更短…`}
                onKeyDown={(e) => e.key === "Enter" && !busy && void onRevise()}
              />
              <button
                type="button"
                disabled={busy || !reviseText.trim()}
                className="shrink-0 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
                onClick={() => void onRevise()}
              >
                改版
              </button>
            </div>
          ) : null}
          </div>

          <StudioAgentDock
            work={work}
            isLoggedIn={isLoggedIn}
            ready={ready}
            parentBusy={busy}
            getAuthHeaders={getAuthHeaders}
            onPersist={persist}
            onWriteBrief={(brief) => {
              const t = brief.trim();
              if (!t) return;
              persist({
                ...work,
                brief: t,
                title: t.slice(0, 48) || work.title,
                status: work.status === "shipped" ? work.status : "briefing"
              });
            }}
            onGeneratePlan={() => onGeneratePlan()}
          />
        </section>
      </div>
    </main>
  );
}
