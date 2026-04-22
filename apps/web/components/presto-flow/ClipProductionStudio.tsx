"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ClipCollaborationNote,
  ClipQcReport,
  ClipRetakeSlot,
  ClipStudioSnapshot,
  ClipTimelineDoc
} from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";

type StudioBundle = {
  timeline_effective?: ClipTimelineDoc | null;
  studio_snapshots?: ClipStudioSnapshot[];
  collaboration_notes?: ClipCollaborationNote[];
  retake_manifest?: ClipRetakeSlot[];
  qc_report?: ClipQcReport | null;
};

type Props = {
  projectId: string;
  transcriptionStatus: string;
  getAuthHeaders: () => Record<string, string>;
  /** 当前排除词（保存快照 / 恢复） */
  excludedWordIds: string[];
  focusedWordId: string | null;
  onRestoreEditState: (excluded: string[], timeline?: ClipTimelineDoc | null) => void;
  onRefreshProject: () => Promise<void>;
  onError: (msg: string) => void;
  /** 嵌入工作台时去掉外层卡片边框 */
  embedded?: boolean;
  /** engineering：仅快照/备注/重录；质检由工作台单独 Tab 承担 */
  tabScope?: "all" | "engineering";
};

type TabId = "project" | "retakes" | "qc";

export default function ClipProductionStudio({
  projectId,
  transcriptionStatus,
  getAuthHeaders,
  excludedWordIds,
  focusedWordId,
  onRestoreEditState,
  onRefreshProject,
  onError,
  embedded,
  tabScope = "all"
}: Props) {
  const { t } = useI18n();
  const engOnly = tabScope === "engineering";
  const [tab, setTab] = useState<TabId>("project");
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<StudioBundle | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [qcBusy, setQcBusy] = useState(false);
  const [retakeLabel, setRetakeLabel] = useState("");

  const loadStudio = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio`, {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as StudioBundle & { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error((data as { detail?: string }).detail || `加载制作间失败 ${res.status}`);
      }
      setBundle({
        timeline_effective: data.timeline_effective,
        studio_snapshots: Array.isArray(data.studio_snapshots) ? data.studio_snapshots : [],
        collaboration_notes: Array.isArray(data.collaboration_notes) ? data.collaboration_notes : [],
        retake_manifest: Array.isArray(data.retake_manifest) ? data.retake_manifest : [],
        qc_report: data.qc_report ?? null
      });
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, onError, projectId]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  useEffect(() => {
    if (engOnly && tab === "qc") setTab("project");
  }, [engOnly, tab]);

  const saveSnapshot = async () => {
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/snapshots`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          label: t("presto.flow.studio.snapshotAutoLabel"),
          excluded_word_ids: excludedWordIds,
          timeline_json: bundle?.timeline_effective ?? undefined
        })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `保存失败 ${res.status}`);
      }
      await loadStudio();
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  };

  const postNote = async () => {
    const body = noteDraft.trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/notes`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          body,
          author: "editor",
          word_id: focusedWordId || undefined
        })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `发送失败 ${res.status}`);
      }
      setNoteDraft("");
      await loadStudio();
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  };

  const runQc = async () => {
    setQcBusy(true);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/qc/analyze`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; qc_report?: ClipQcReport; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `质检失败 ${res.status}`);
      }
      setBundle((b) => ({ ...(b || {}), qc_report: data.qc_report ?? null }));
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    } finally {
      setQcBusy(false);
    }
  };

  const addRetakeSlot = async () => {
    const wid = (focusedWordId || "").trim();
    if (!wid) {
      onError(t("presto.flow.studio.retakeNeedFocus"));
      return;
    }
    const next: ClipRetakeSlot[] = [
      ...(bundle?.retake_manifest || []),
      {
        id: crypto.randomUUID(),
        after_word_id: wid,
        label: retakeLabel.trim() || t("presto.flow.studio.retakeDefaultLabel"),
        status: "pending",
        takes: [],
        active_take_index: 0
      }
    ];
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/studio/retakes`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ manifest: next })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `写入失败 ${res.status}`);
      }
      setRetakeLabel("");
      await loadStudio();
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  };

  const uploadTake = async (slotId: string, file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(
        `/api/clip/projects/${encodeURIComponent(projectId)}/studio/retakes/${encodeURIComponent(slotId)}/take`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-clip-filename": file.name || "retake.webm",
            "x-clip-mime": file.type || "application/octet-stream",
            ...getAuthHeaders()
          },
          body: buf
        }
      );
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `上传失败 ${res.status}`);
      }
      await loadStudio();
      await onRefreshProject();
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e));
    }
  };

  const tabBtn = (id: TabId, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={[
        "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition",
        tab === id ? "bg-brand/18 text-brand" : "text-muted hover:bg-fill hover:text-ink"
      ].join(" ")}
    >
      {label}
    </button>
  );

  if (loading && !bundle) {
    return (
      <div className="rounded-xl border border-line bg-surface/50 p-6 text-sm text-muted">{t("clip.loading")}</div>
    );
  }

  const shell = embedded
    ? "flex min-h-0 flex-1 flex-col gap-2 p-1"
    : "flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-line bg-surface/40 p-3";

  return (
    <div className={shell}>
      <div className="flex flex-wrap gap-1 border-b border-line/60 pb-2">
        {tabBtn("project", t("presto.flow.studio.tabProject"))}
        {tabBtn("retakes", t("presto.flow.studio.tabRetakes"))}
        {!engOnly ? tabBtn("qc", t("presto.flow.studio.tabQc")) : null}
      </div>

      {tab === "project" ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-[12px]">
          <section>
            <h3 className="mb-2 font-semibold text-ink">{t("presto.flow.studio.snapshotsTitle")}</h3>
            <button
              type="button"
              className="mb-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-[11px] font-semibold text-brand hover:bg-brand/15"
              onClick={() => void saveSnapshot()}
            >
              {t("presto.flow.studio.saveSnapshot")}
            </button>
            <ul className="space-y-2">
              {(bundle?.studio_snapshots || []).map((s) => (
                <li key={s.id || s.created_at} className="rounded-lg border border-line bg-fill/25 p-2">
                  <p className="font-medium text-ink">{s.label}</p>
                  <p className="text-[10px] text-muted">{s.created_at}</p>
                  <button
                    type="button"
                    className="mt-1 text-[10px] font-semibold text-brand underline"
                    onClick={() =>
                      onRestoreEditState(
                        Array.isArray(s.excluded_word_ids) ? s.excluded_word_ids.map(String) : [],
                        (s.timeline_json as ClipTimelineDoc | null | undefined) ?? null
                      )
                    }
                  >
                    {t("presto.flow.studio.restoreSnapshot")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-semibold text-ink">{t("presto.flow.studio.notesTitle")}</h3>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              className="mb-2 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] text-ink"
              placeholder={t("presto.flow.studio.notePlaceholder")}
            />
            <button
              type="button"
              className="rounded-lg border border-line bg-fill px-3 py-1 text-[11px] font-medium text-ink hover:bg-fill/80"
              onClick={() => void postNote()}
            >
              {t("presto.flow.studio.postNote")}
            </button>
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {(bundle?.collaboration_notes || []).map((n) => (
                <li key={n.id || n.body.slice(0, 12)} className="rounded border border-line/60 bg-surface/60 p-2 text-[11px]">
                  <span className="text-muted">{n.author}</span>
                  {n.word_id ? <span className="ml-2 text-brand">#{n.word_id.slice(0, 8)}…</span> : null}
                  <p className="mt-1 text-ink">{n.body}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "retakes" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-[12px]">
          <p className="text-muted">{t("presto.flow.studio.retakesIntro")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-[10px] text-muted">
              {t("presto.flow.studio.retakeLabel")}
              <input
                value={retakeLabel}
                onChange={(e) => setRetakeLabel(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink"
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-[11px] font-semibold text-brand"
              onClick={() => void addRetakeSlot()}
            >
              {t("presto.flow.studio.addRetakeSlot")}
            </button>
          </div>
          <ul className="space-y-3">
            {(bundle?.retake_manifest || []).map((r) => (
              <li key={r.id} className="rounded-lg border border-line bg-fill/20 p-2">
                <p className="font-medium text-ink">{r.label}</p>
                <p className="text-[10px] text-muted">
                  {t("presto.flow.studio.afterWord")}: {r.after_word_id}
                </p>
                <p className="text-[10px] text-muted">
                  {t("presto.flow.studio.takeCount")}: {r.takes?.length ?? 0}
                </p>
                <label className="mt-2 inline-block cursor-pointer rounded border border-line bg-surface px-2 py-1 text-[10px] font-medium hover:bg-fill">
                  {t("presto.flow.studio.uploadTake")}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadTake(r.id, f);
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!engOnly && tab === "qc" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-[12px]">
          <p className="text-muted">{t("presto.flow.studio.qcIntro")}</p>
          <button
            type="button"
            disabled={qcBusy}
            className="rounded-lg border border-line bg-fill px-3 py-2 text-[11px] font-semibold text-ink hover:bg-fill/80 disabled:opacity-50"
            onClick={() => void runQc()}
          >
            {qcBusy ? "…" : t("presto.flow.studio.runQc")}
          </button>
          {bundle?.qc_report ? (
            <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-canvas p-2 text-[10px] leading-relaxed text-ink">
              {JSON.stringify(bundle.qc_report, null, 2)}
            </pre>
          ) : (
            <p className="text-muted">{t("presto.flow.studio.qcEmpty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
