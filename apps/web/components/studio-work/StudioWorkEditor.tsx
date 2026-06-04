"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { deliverableToManuscriptBlocks, diffBlockKeys, mergeBlocks, nextVersionLabel } from "../../lib/studioDeliverable";
import { useNotebooksHubQuery } from "../../lib/queries/notebooksQueries";
import { runComposerExpertDeliverableJob } from "../../lib/homeComposerExpertJob";
import { isFeatureCoreComplete } from "../../lib/homeComposerFeatureCore";
import { FEATURE_CORE_FIELDS } from "../../lib/homeComposerPersonalFields";
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
  const [mobilePanel, setMobilePanel] = useState<"manuscript" | "corpus" | "agent">("manuscript");
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
          <span className="text-[11px] text-muted">
            资料{work.binding.noteIds.length || "0"} · {work.plan?.voiceEnabled ? "Voice✓" : "Voice—"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
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

      <div className="flex shrink-0 gap-1 border-b border-line px-3 py-2 lg:hidden">
        {(
          [
            ["manuscript", "稿件"],
            ["corpus", "资料"],
            ["agent", "助手"]
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
            "w-full shrink-0 border-r border-line bg-fill/20 p-3 lg:block lg:w-56",
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
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-xs font-medium text-ink">
              Voice / 我的特色
              {isFeatureCoreComplete(work.featureCore) ? (
                <span className="ml-1 text-brand">✓</span>
              ) : (
                <span className="ml-1 text-warning-ink">未填全</span>
              )}
            </p>
            {FEATURE_CORE_FIELDS.map(({ key, label, placeholder, rows }) => (
              <label key={key} className="mt-2 block text-[11px] text-muted">
                <span className="line-clamp-2">{label}</span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                  rows={Math.min(rows, 2)}
                  value={work.featureCore[key]}
                  placeholder={placeholder}
                  onChange={(e) =>
                    persist({
                      ...work,
                      featureCore: { ...work.featureCore, [key]: e.target.value }
                    })
                  }
                />
              </label>
            ))}
          </div>
        </aside>

        <section
          className={[
            "flex min-h-0 min-w-0 flex-1 flex-col",
            mobilePanel === "manuscript" || mobilePanel === "agent" ? "flex" : "hidden lg:flex"
          ].join(" ")}
        >
          <div
            className={[
              "min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4",
              mobilePanel === "agent" ? "hidden lg:block" : ""
            ].join(" ")}
          >
          {(work.status === "briefing" || work.status === "planned") && !work.plan ? (
            <div className="mb-4 rounded-xl border border-line bg-fill/30 p-4">
              <label className="block text-sm font-medium text-ink">任务说明（Brief）</label>
              <textarea
                className="mt-2 min-h-[100px] w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={work.brief}
                onChange={(e) => persist({ ...work, brief: e.target.value, title: e.target.value.slice(0, 48) || work.title })}
                placeholder="例如：把 Q1 产品复盘写成可发的小红书，要 3 个标题…"
              />
              {!isLoggedIn && ready ? (
                <p className="mt-2 text-xs text-warning-ink">登录后可生成计划与稿件</p>
              ) : null}
            </div>
          ) : null}

          {showPlan && work.plan ? (
            <div className="mb-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
              <h2 className="text-sm font-semibold text-ink">计划</h2>
              <p className="mt-1 text-sm text-ink">{work.plan.goal}</p>
              <ul className="mt-2 list-inside list-disc text-xs text-muted">
                {work.plan.outline.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {work.plan.inferenceSummary.length ? (
                <p className="mt-2 text-xs text-muted">
                  推断：{work.plan.inferenceSummary.join(" · ")}
                </p>
              ) : null}
              {work.plan.risks.length ? (
                <ul className="mt-2 text-xs text-warning-ink">
                  {work.plan.risks.map((r) => (
                    <li key={r}>⚠ {r}</li>
                  ))}
                </ul>
              ) : null}
              {work.status === "planned" ? (
                <button
                  type="button"
                  disabled={busy || !isLoggedIn}
                  className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
                  onClick={() => void onConfirmGenerate()}
                >
                  确认生成
                </button>
              ) : null}
            </div>
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
            <div className="mt-2 shrink-0 rounded-xl border border-brand/40 bg-brand/5 p-3">
              <p className="text-xs text-ink">
                {work.pendingPatch.summary} · 勾选要采纳的块
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                  onClick={() => onApplyPatch(true)}
                >
                  采纳所选 ({selectedPatchKeys.size})
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs"
                  onClick={() => onApplyPatch(false)}
                >
                  全部采纳
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
                  onClick={() => persist({ ...work, pendingPatch: undefined })}
                >
                  放弃
                </button>
              </div>
            </div>
          ) : null}

          {work.status === "ready" && !work.pendingPatch ? (
            <div className="mt-2 shrink-0 border-t border-line pt-3">
              <label className="text-xs text-muted">对 {activeVersion?.label || "当前版"} 改：</label>
              <div className="mt-1 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  value={reviseText}
                  onChange={(e) => setReviseText(e.target.value)}
                  placeholder="例如：标题更短更狠，正文别动"
                  onKeyDown={(e) => e.key === "Enter" && !busy && void onRevise()}
                />
                <button
                  type="button"
                  disabled={busy || !reviseText.trim()}
                  className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
                  onClick={() => void onRevise()}
                >
                  提交改版
                </button>
              </div>
            </div>
          ) : null}
          </div>

          <div className={mobilePanel === "agent" ? "hidden lg:contents" : "contents"}>
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
          </div>
          {mobilePanel === "agent" ? (
            <div className="flex min-h-0 flex-1 flex-col lg:hidden">
              <StudioAgentDock
                expanded
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
            </div>
          ) : null}
        </section>

        <aside
          className={[
            "w-full shrink-0 border-l border-line p-3 xl:block xl:w-72",
            mobilePanel === "agent" ? "hidden" : "hidden xl:block"
          ].join(" ")}
        >
          <p className="text-xs font-medium text-ink">Plan / Runs</p>
          {work.plan ? (
            <div className="mt-2 rounded-lg border border-line bg-fill/20 p-2 text-[11px] text-muted">
              <p className="font-medium text-ink">{work.plan.goal}</p>
              <ul className="mt-1 list-inside list-disc">
                {work.plan.outline.slice(0, 4).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted">生成计划后在此查看摘要；需求澄清请用中栏底部 Agent。</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            纯问答无 Work 时用{" "}
            <Link href="/chat" className="text-brand">
              经典对话
            </Link>
            。
          </p>
        </aside>
      </div>
    </main>
  );
}
