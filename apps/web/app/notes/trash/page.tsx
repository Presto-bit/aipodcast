"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "../../../components/ui/EmptyState";
import { useAuth } from "../../../lib/auth";
import { shouldHideWorkFromUserGallery } from "../../../lib/worksTypes";

type NoteRow = {
  noteId: string;
  title?: string;
  notebook?: string;
  deletedAt?: string;
};

type WorkRow = {
  id: string;
  title?: string;
  type?: string;
  deletedAt?: string;
};

async function postRestoreNote(noteId: string, headers: Record<string, string>) {
  const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/restore`, {
    method: "POST",
    headers: { ...headers }
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
  return { ok: res.ok && Boolean(data.success), detail: String(data.detail || res.status) };
}

async function deletePurgeNote(noteId: string, headers: Record<string, string>) {
  const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/purge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}"
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
  return { ok: res.ok && Boolean(data.success), detail: String(data.detail || res.status) };
}

async function postRestoreWork(workId: string, headers: Record<string, string>) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(workId)}/restore`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: "{}"
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
  return { ok: res.ok && Boolean(data.success), detail: String(data.detail || res.status) };
}

async function deletePurgeWork(workId: string, headers: Record<string, string>) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(workId)}/purge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}"
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
  return { ok: res.ok && Boolean(data.success), detail: String(data.detail || res.status) };
}

export default function NotesTrashPage() {
  const { getAuthHeaders } = useAuth();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [selectedWorkIds, setSelectedWorkIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const authHdr = getAuthHeaders();
      const [notesRes, worksRes] = await Promise.all([
        fetch("/api/notes/trash?limit=80&offset=0", { cache: "no-store", headers: { ...authHdr } }),
        fetch("/api/works/trash?limit=80&offset=0", { cache: "no-store", headers: { ...authHdr } })
      ]);
      const notesData = (await notesRes.json().catch(() => ({}))) as { success?: boolean; notes?: NoteRow[]; error?: string };
      const worksData = (await worksRes.json().catch(() => ({}))) as {
        success?: boolean;
        ai?: WorkRow[];
        tts?: WorkRow[];
        notes?: WorkRow[];
        error?: string;
      };
      if (!notesRes.ok || !notesData.success) throw new Error(notesData.error || `加载笔记回收站失败 ${notesRes.status}`);
      if (!worksRes.ok || !worksData.success) throw new Error(worksData.error || `加载作品回收站失败 ${worksRes.status}`);
      const nextNotes = Array.isArray(notesData.notes) ? notesData.notes : [];
      const nextWorks = [...(worksData.ai || []), ...(worksData.tts || []), ...(worksData.notes || [])].filter(
        (w) => !shouldHideWorkFromUserGallery(w)
      );
      setNotes(nextNotes);
      setWorks(nextWorks);
      const noteIdSet = new Set(nextNotes.map((n) => n.noteId));
      const workIdSet = new Set(nextWorks.map((w) => w.id));
      setSelectedNoteIds((xs) => xs.filter((id) => noteIdSet.has(id)));
      setSelectedWorkIds((xs) => xs.filter((id) => workIdSet.has(id)));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const bulkDisabled = busy !== null;
  const selectedNotesOnPage = selectedNoteIds.filter((id) => notes.some((n) => n.noteId === id));
  const selectedWorksOnPage = selectedWorkIds.filter((id) => works.some((w) => w.id === id));

  function toggleNoteSelected(noteId: string) {
    setSelectedNoteIds((xs) => (xs.includes(noteId) ? xs.filter((x) => x !== noteId) : [...xs, noteId]));
  }

  function toggleWorkSelected(workId: string) {
    setSelectedWorkIds((xs) => (xs.includes(workId) ? xs.filter((x) => x !== workId) : [...xs, workId]));
  }

  function toggleSelectAllNotes() {
    const ids = notes.map((n) => n.noteId);
    const allOn = ids.length > 0 && ids.every((id) => selectedNoteIds.includes(id));
    if (allOn) {
      setSelectedNoteIds((xs) => xs.filter((x) => !ids.includes(x)));
    } else {
      setSelectedNoteIds((xs) => [...new Set([...xs, ...ids])]);
    }
  }

  function toggleSelectAllWorks() {
    const ids = works.map((w) => w.id);
    const allOn = ids.length > 0 && ids.every((id) => selectedWorkIds.includes(id));
    if (allOn) {
      setSelectedWorkIds((xs) => xs.filter((x) => !ids.includes(x)));
    } else {
      setSelectedWorkIds((xs) => [...new Set([...xs, ...ids])]);
    }
  }

  async function restore(noteId: string) {
    setBusy(noteId);
    setErr("");
    try {
      const { ok, detail } = await postRestoreNote(noteId, getAuthHeaders());
      if (!ok) throw new Error(detail);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function purge(noteId: string) {
    if (!window.confirm("永久删除后无法恢复，确定？")) return;
    setBusy(noteId);
    setErr("");
    try {
      const { ok, detail } = await deletePurgeNote(noteId, getAuthHeaders());
      if (!ok) throw new Error(detail);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function restoreWork(id: string) {
    setBusy(`work:${id}`);
    setErr("");
    try {
      const { ok, detail } = await postRestoreWork(id, getAuthHeaders());
      if (!ok) throw new Error(detail);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function purgeWork(id: string) {
    if (!window.confirm("永久删除作品后无法恢复，确定？")) return;
    setBusy(`work:${id}`);
    setErr("");
    try {
      const { ok, detail } = await deletePurgeWork(id, getAuthHeaders());
      if (!ok) throw new Error(detail);
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function bulkRestoreNotes(ids: string[]) {
    if (ids.length === 0) return;
    const hdrs = getAuthHeaders();
    setBusy("bulk-notes-restore");
    setErr("");
    try {
      const results = await Promise.all(ids.map((id) => postRestoreNote(id, hdrs)));
      const failed = results.filter((r) => !r.ok).length;
      await load();
      if (failed > 0) {
        setErr(`笔记恢复完成，但有 ${failed} / ${ids.length} 条失败，可重试。`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function bulkPurgeNotes(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`确定永久删除已选的 ${ids.length} 条笔记？此操作不可恢复。`)) return;
    const hdrs = getAuthHeaders();
    setBusy("bulk-notes-purge");
    setErr("");
    try {
      const results = await Promise.all(ids.map((id) => deletePurgeNote(id, hdrs)));
      const failed = results.filter((r) => !r.ok).length;
      await load();
      if (failed > 0) {
        setErr(`笔记删除未完成：${failed} / ${ids.length} 条失败，请重试。`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function bulkRestoreWorks(ids: string[]) {
    if (ids.length === 0) return;
    const hdrs = getAuthHeaders();
    setBusy("bulk-works-restore");
    setErr("");
    try {
      const results = await Promise.all(ids.map((id) => postRestoreWork(id, hdrs)));
      const failed = results.filter((r) => !r.ok).length;
      await load();
      if (failed > 0) {
        setErr(`作品恢复完成，但有 ${failed} / ${ids.length} 条失败，可重试。`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function bulkPurgeWorks(ids: string[]) {
    if (ids.length === 0) return;
    if (!window.confirm(`确定永久删除已选的 ${ids.length} 个作品？此操作不可恢复。`)) return;
    const hdrs = getAuthHeaders();
    setBusy("bulk-works-purge");
    setErr("");
    try {
      const results = await Promise.all(ids.map((id) => deletePurgeWork(id, hdrs)));
      const failed = results.filter((r) => !r.ok).length;
      await load();
      if (failed > 0) {
        setErr(`作品删除未完成：${failed} / ${ids.length} 条失败，请重试。`);
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const notesAllSelected = notes.length > 0 && notes.every((n) => selectedNoteIds.includes(n.noteId));
  const worksAllSelected = works.length > 0 && works.every((w) => selectedWorkIds.includes(w.id));

  return (
    <main className="mx-auto min-h-0 w-full max-w-4xl px-3 pb-10 sm:px-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/notes" className="text-sm text-brand hover:text-brand/80">
          ← 笔记本
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-ink">回收站</h1>
      <p className="mt-2 text-sm text-muted">
        删除的笔记与作品会进入此处；可恢复，或永久删除。回收站内容默认保留 7 天，超时自动清理。
      </p>

      {err ? <p className="mt-4 text-sm text-danger-ink">{err}</p> : null}

      {loading ? (
        <p className="mt-8 text-sm text-muted">加载中…</p>
      ) : notes.length === 0 && works.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="回收站为空"
          description="删除笔记或作品后，会出现在这里。"
        />
      ) : (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">已删除笔记</h2>
            {notes.length === 0 ? (
              <p className="text-xs text-muted">暂无已删除笔记</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-fill/40 px-2 py-2 text-xs text-ink">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand"
                      checked={notesAllSelected}
                      disabled={bulkDisabled}
                      onChange={() => toggleSelectAllNotes()}
                      aria-label="全选已删除笔记"
                    />
                    全选
                  </label>
                  <span className="text-muted">
                    已选 {selectedNotesOnPage.length} / {notes.length}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={bulkDisabled || selectedNotesOnPage.length === 0}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-surface/90 disabled:opacity-50"
                      onClick={() => void bulkRestoreNotes(selectedNotesOnPage)}
                    >
                      恢复所选
                    </button>
                    <button
                      type="button"
                      disabled={bulkDisabled || selectedNotesOnPage.length === 0}
                      className="rounded-lg border border-danger/40 bg-surface px-2.5 py-1 text-xs text-danger-ink hover:bg-danger-soft disabled:opacity-50"
                      onClick={() => void bulkPurgeNotes(selectedNotesOnPage)}
                    >
                      永久删除所选
                    </button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li
                      key={n.noteId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-brand"
                          checked={selectedNoteIds.includes(n.noteId)}
                          disabled={bulkDisabled}
                          onChange={() => toggleNoteSelected(n.noteId)}
                          aria-label={`选择「${n.title || n.noteId}」`}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{n.title || n.noteId}</p>
                          <p className="text-xs text-muted">
                            {n.notebook} · 删除于 {n.deletedAt?.replace("T", " ").slice(0, 19) || "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                          onClick={() => void restore(n.noteId)}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="rounded-lg border border-danger/40 px-3 py-1 text-xs text-danger-ink hover:bg-danger-soft disabled:opacity-50"
                          onClick={() => void purge(n.noteId)}
                        >
                          永久删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">已删除作品</h2>
            {works.length === 0 ? (
              <p className="text-xs text-muted">暂无已删除作品</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-fill/40 px-2 py-2 text-xs text-ink">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand"
                      checked={worksAllSelected}
                      disabled={bulkDisabled}
                      onChange={() => toggleSelectAllWorks()}
                      aria-label="全选已删除作品"
                    />
                    全选
                  </label>
                  <span className="text-muted">
                    已选 {selectedWorksOnPage.length} / {works.length}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={bulkDisabled || selectedWorksOnPage.length === 0}
                      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-surface/90 disabled:opacity-50"
                      onClick={() => void bulkRestoreWorks(selectedWorksOnPage)}
                    >
                      恢复所选
                    </button>
                    <button
                      type="button"
                      disabled={bulkDisabled || selectedWorksOnPage.length === 0}
                      className="rounded-lg border border-danger/40 bg-surface px-2.5 py-1 text-xs text-danger-ink hover:bg-danger-soft disabled:opacity-50"
                      onClick={() => void bulkPurgeWorks(selectedWorksOnPage)}
                    >
                      永久删除所选
                    </button>
                  </div>
                </div>
                <ul className="space-y-2">
                  {works.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 text-sm"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 accent-brand"
                          checked={selectedWorkIds.includes(w.id)}
                          disabled={bulkDisabled}
                          onChange={() => toggleWorkSelected(w.id)}
                          aria-label={`选择作品「${w.title || w.id}」`}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{w.title || w.id}</p>
                          <p className="text-xs text-muted">
                            {w.type || "未知类型"} · 删除于 {w.deletedAt?.replace("T", " ").slice(0, 19) || "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                          onClick={() => void restoreWork(w.id)}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          className="rounded-lg border border-danger/40 px-3 py-1 text-xs text-danger-ink hover:bg-danger-soft disabled:opacity-50"
                          onClick={() => void purgeWork(w.id)}
                        >
                          永久删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
