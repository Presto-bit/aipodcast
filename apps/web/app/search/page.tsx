"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

type NoteHit = { id: string; title?: string; notebook?: string; snippet?: string; created_at?: string };
type JobHit = { id: string; job_type?: string; status?: string; snippet?: string; created_at?: string };

export default function SearchPage() {
  const { getAuthHeaders } = useAuth();
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    const query = q.trim();
    if (query.length < 2) {
      setNotes([]);
      setJobs([]);
      setErr("至少输入 2 个字符");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=40`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        notes?: NoteHit[];
        jobs?: JobHit[];
        error?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || `搜索失败 ${res.status}`);
      setNotes(Array.isArray(data.notes) ? data.notes : []);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      setNotes([]);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [q, getAuthHeaders]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim().length >= 2) void run();
    }, 320);
    return () => window.clearTimeout(t);
  }, [q, run]);

  return (
    <main className="mx-auto min-h-0 w-full max-w-4xl px-3 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink">搜索</h1>
      <p className="mt-2 text-sm text-muted">在笔记正文与创作记录里搜索（至少输入 2 个字）。</p>

      <div className="mt-6 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="global-search-q">
          搜索关键词
        </label>
        <input
          id="global-search-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="输入关键词…"
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          autoComplete="off"
        />
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm text-brand-foreground hover:bg-brand disabled:opacity-50"
          disabled={loading}
          onClick={() => void run()}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
      </div>

      {err ? <p className="mt-3 text-sm text-danger-ink">{err}</p> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">笔记</h2>
        <ul className="mt-2 space-y-2">
          {notes.length === 0 ? (
            <li className="text-sm text-muted">{q.trim().length >= 2 && !loading ? "无匹配笔记" : "—"}</li>
          ) : (
            notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <Link
                  href={`/notes?note=${encodeURIComponent(n.id)}`}
                  className="font-medium text-brand hover:underline"
                >
                  {n.title || "未命名"}
                </Link>
                <span className="ml-2 text-xs text-muted">{n.notebook}</span>
                {n.snippet ? <p className="mt-1 line-clamp-3 text-xs text-muted">{n.snippet}</p> : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">创作记录</h2>
        <ul className="mt-2 space-y-2">
          {jobs.length === 0 ? (
            <li className="text-sm text-muted">{q.trim().length >= 2 && !loading ? "没有匹配的生成记录" : "—"}</li>
          ) : (
            jobs.map((j) => (
              <li key={j.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
                <Link href={`/jobs/${j.id}`} className="font-mono text-brand hover:underline">
                  {j.id.slice(0, 8)}…
                </Link>
                <span className="ml-2 text-xs text-muted">
                  {j.job_type} · {j.status}
                </span>
                {j.snippet ? <p className="mt-1 line-clamp-2 text-xs text-muted">{j.snippet}</p> : null}
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
