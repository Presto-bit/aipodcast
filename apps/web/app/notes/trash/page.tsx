"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "../../../components/ui/EmptyState";
import { useAuth } from "../../../lib/auth";

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

export default function NotesTrashPage() {
  const { getAuthHeaders } = useAuth();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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
      setNotes(Array.isArray(notesData.notes) ? notesData.notes : []);
      setWorks([...(worksData.ai || []), ...(worksData.tts || []), ...(worksData.notes || [])]);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) throw new Error(String(data.detail || res.status));
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  async function purge(id: string) {
    if (!window.confirm("永久删除后无法恢复，确定？")) return;
    setBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}/purge`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) throw new Error(String(data.detail || res.status));
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
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "content-type": "application/json" },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) throw new Error(String(data.detail || res.status));
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
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/purge`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) throw new Error(String(data.detail || res.status));
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-4xl px-3 pb-10 sm:px-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/notes" className="text-sm text-brand hover:text-brand/80">
          ← 笔记播客
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-ink">回收站</h1>
      <p className="mt-2 text-sm text-muted">
        删除的笔记与作品会进入此处；可恢复，或永久删除。回收站内容默认保留 7 天，超时自动清理。
      </p>

      {err ? <p className="mt-4 text-sm text-rose-600">{err}</p> : null}

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
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li
                    key={n.noteId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{n.title || n.noteId}</p>
                      <p className="text-xs text-muted">
                        {n.notebook} · 删除于 {n.deletedAt?.replace("T", " ").slice(0, 19) || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy === n.noteId}
                        className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                        onClick={() => void restore(n.noteId)}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        disabled={busy === n.noteId}
                        className="rounded-lg border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        onClick={() => void purge(n.noteId)}
                      >
                        永久删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">已删除作品</h2>
            {works.length === 0 ? (
              <p className="text-xs text-muted">暂无已删除作品</p>
            ) : (
              <ul className="space-y-2">
                {works.map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{w.title || w.id}</p>
                      <p className="text-xs text-muted">
                        {w.type || "未知类型"} · 删除于 {w.deletedAt?.replace("T", " ").slice(0, 19) || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy === `work:${w.id}`}
                        className="rounded-lg border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                        onClick={() => void restoreWork(w.id)}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        disabled={busy === `work:${w.id}`}
                        className="rounded-lg border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        onClick={() => void purgeWork(w.id)}
                      >
                        永久删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
