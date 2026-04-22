"use client";

import Link from "next/link";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { clipJobLabel } from "../../lib/clipJobLabels";
import type { ClipProjectRow } from "../../lib/clipTypes";
import { useI18n } from "../../lib/I18nContext";
import SmallConfirmModal from "../ui/SmallConfirmModal";

function formatClipHubDate(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(d);
}

function clipHubProgressLine(
  t: (key: string) => string,
  transcriptionStatus: string | undefined,
  exportStatus: string | undefined
): string {
  const parts: string[] = [];
  const tr = transcriptionStatus || "idle";
  const ex = exportStatus || "idle";
  if (tr !== "idle") {
    parts.push(`${t("clip.status.transcription")}: ${clipJobLabel(t, "transcription", tr)}`);
  }
  if (ex !== "idle") {
    parts.push(`${t("clip.status.export")}: ${clipJobLabel(t, "export", ex)}`);
  }
  if (parts.length === 0) return t("clip.hub.statusPending");
  return parts.join(" · ");
}

export default function ClipHub() {
  const { t, lang } = useI18n();
  const { getAuthHeaders } = useAuth();
  const [items, setItems] = useState<ClipProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClipProjectRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const locale = lang === "en" ? "en-US" : "zh-CN";

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

  async function saveRename(projectId: string) {
    const title = renameDraft.trim().slice(0, 200) || t("clip.defaultProjectTitle");
    setRenameBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        project?: ClipProjectRow;
        detail?: string;
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `重命名失败 ${res.status}`);
      }
      setRenamingId(null);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRenameBusy(false);
    }
  }

  async function confirmDeleteProject() {
    if (!deleteTarget?.id) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/clip/projects/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.detail || `删除失败 ${res.status}`);
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setDeleteErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-5xl px-3 pb-14 sm:px-4">
      <SmallConfirmModal
        open={Boolean(deleteTarget)}
        title={t("clip.editor.deleteConfirmTitle")}
        message={t("clip.editor.deleteConfirmMessage")}
        confirmLabel={t("clip.editor.deleteConfirm")}
        cancelLabel={t("clip.editor.deleteCancel")}
        danger
        busy={deleteBusy}
        busyLabel={t("clip.editor.deleting")}
        error={deleteErr}
        onCancel={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteErr(null);
        }}
        onConfirm={() => void confirmDeleteProject()}
      />

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
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-fill/50 p-4 transition hover:bg-fill">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {renamingId === p.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          maxLength={200}
                          disabled={renameBusy}
                          aria-label={t("clip.editor.renameFieldAria")}
                          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveRename(p.id);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={renameBusy}
                          className="shrink-0 rounded-md border border-line bg-surface p-1.5 text-mint shadow-soft hover:bg-fill disabled:opacity-50"
                          aria-label={t("clip.hub.renameSave")}
                          onClick={() => void saveRename(p.id)}
                        >
                          <Check className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          disabled={renameBusy}
                          className="shrink-0 rounded-md border border-line bg-surface p-1.5 text-muted shadow-soft hover:bg-fill disabled:opacity-50"
                          aria-label={t("clip.hub.renameCancel")}
                          onClick={() => setRenamingId(null)}
                        >
                          <X className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <Link
                        href={`/clip/${encodeURIComponent(p.id)}`}
                        className="block text-sm font-medium text-ink transition hover:opacity-90"
                      >
                        <span className="flex flex-wrap items-center gap-2">
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
                      </Link>
                    )}
                    <p className="mt-1 text-[10px] leading-relaxed text-muted">
                      {t("clip.hub.createdAtShort")} {formatClipHubDate(p.created_at, locale)} · {t("clip.hub.updatedAtShort")}{" "}
                      {formatClipHubDate(p.updated_at, locale)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{clipHubProgressLine(t, p.transcription_status, p.export_status)}</p>
                  </div>
                  {renamingId !== p.id ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="rounded-lg border border-line bg-surface p-2 text-muted shadow-soft hover:bg-fill hover:text-ink"
                        aria-label={t("clip.hub.rename")}
                        onClick={(e) => {
                          e.preventDefault();
                          setRenameDraft(p.title || p.id);
                          setRenamingId(p.id);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-danger/40 bg-surface p-2 text-danger-ink shadow-soft hover:bg-danger-soft"
                        aria-label={t("clip.hub.deleteProject")}
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteErr(null);
                          setDeleteTarget(p);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
