"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeClipFilenameForHttpHeader } from "../../lib/clipFilenameHeader";
import { useAuth } from "../../lib/auth";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";

function hasClipAudio(p: ClipProjectRow): boolean {
  return Boolean(p.has_audio) || Boolean(p.audio_download_url);
}

export default function ClipHub() {
  const { t } = useI18n();
  const { getAuthHeaders } = useAuth();
  const [items, setItems] = useState<ClipProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((p) => (p.title || p.id || "").toLowerCase().includes(s));
  }, [items, q]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch("/api/clip/projects?limit=80", {
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        projects?: ClipProjectRow[];
        detail?: string;
        error?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || data.error || `加载失败 ${res.status}`);
      }
      setItems(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/clip/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: t("clip.defaultProjectTitle") })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; project?: ClipProjectRow; detail?: string };
      if (!res.ok || data.success === false || !data.project?.id) {
        throw new Error(data.detail || `创建失败 ${res.status}`);
      }
      window.location.href = `/clip/${encodeURIComponent(data.project.id)}`;
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAudioToProject(projectId: string, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    if (!f) return;
    setUploadBusyId(projectId);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}/audio`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": f.type || "application/octet-stream",
          "x-clip-filename": encodeClipFilenameForHttpHeader(f.name, "upload.mp3"),
          ...getAuthHeaders()
        },
        body: f
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `上传失败 ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setUploadBusyId(null);
    }
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-5xl px-3 pb-14 sm:px-4">
      <header className="border-b border-line pb-8 pt-6 sm:pt-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t("clip.pageTitle")}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted sm:text-[15px]">{t("clip.pageSubtitle")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground shadow-soft transition hover:opacity-95 disabled:opacity-50"
            disabled={busy}
            onClick={() => void createProject()}
          >
            {busy ? t("clip.creating") : t("clip.cta.primary")}
          </button>
          <button
            type="button"
            className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-fill"
            disabled={loading}
            onClick={() => void load()}
          >
            {t("clip.refresh")}
          </button>
        </div>
        {err ? (
          <p className="mt-4 text-sm text-danger-ink" role="alert">
            {err}
          </p>
        ) : null}
      </header>

      <section className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-ink">{t("clip.projectList")}</h2>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("clip.searchPlaceholder")}
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted sm:w-64"
            aria-label={t("clip.searchPlaceholder")}
          />
        </div>
        {loading ? <p className="mt-3 text-sm text-muted">{t("clip.loading")}</p> : null}
        {!loading && items.length === 0 ? <p className="mt-3 text-sm text-muted">{t("clip.emptyProjects")}</p> : null}
        {!loading && items.length > 0 && filtered.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("clip.emptyFilter")}</p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {filtered.map((p) => (
            <li key={p.id}>
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-fill/50 p-4 transition hover:bg-fill sm:flex-row sm:items-stretch sm:justify-between">
                <Link
                  href={`/clip/${encodeURIComponent(p.id)}`}
                  className="min-w-0 flex-1 text-sm transition hover:opacity-90"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium text-ink">
                    {p.title || p.id}
                    {p.transcription_status === "failed" ? (
                      <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger-ink">
                        {t("clip.badgeFailedTranscription")}
                      </span>
                    ) : null}
                    {p.export_status === "failed" ? (
                      <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger-ink">
                        {t("clip.badgeFailedExport")}
                      </span>
                    ) : null}
                    {p.transcription_status === "queued" || p.export_status === "queued" ? (
                      <span className="rounded bg-fill px-1.5 py-0.5 text-[10px] font-medium text-muted ring-1 ring-line">
                        {t("clip.badgeQueued")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {t("clip.status.transcription")}: {p.transcription_status} · {t("clip.status.export")}: {p.export_status}
                  </span>
                </Link>
                {!hasClipAudio(p) ? (
                  <div className="flex shrink-0 flex-col gap-1 border-t border-line pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                    <label className="inline-flex cursor-pointer items-center justify-center sm:justify-end">
                      <span className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink shadow-soft hover:bg-fill">
                        {uploadBusyId === p.id ? t("clip.hub.uploading") : t("clip.hub.uploadAudio")}
                      </span>
                      <input
                        type="file"
                        className="sr-only"
                        accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm"
                        disabled={uploadBusyId === p.id}
                        onChange={(e) => {
                          void uploadAudioToProject(p.id, e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <p className="max-w-xs text-[10px] leading-relaxed text-muted sm:text-right">{t("clip.hub.uploadHint")}</p>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
