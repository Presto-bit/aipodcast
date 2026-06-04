"use client";

import { useState } from "react";
import { useNotebooksHubQuery } from "../../lib/queries/notebooksQueries";
import type { StudioWork } from "../../lib/studioWorkTypes";

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

export default function StudioCorpusBar({
  work,
  isLoggedIn,
  ready,
  getAuthHeaders,
  onPersist
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready);

  const bound =
    work.binding.notebook && work.binding.noteIds.length
      ? `@${work.binding.notebook} · ${work.binding.noteIds.length} 篇`
      : work.binding.notebook
        ? `@${work.binding.notebook}`
        : null;

  return (
    <div className="border-t border-line/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-[11px] text-muted hover:bg-fill/40 hover:text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium">资料</span>
        {bound ? <span className="truncate text-ink">{bound}</span> : <span>未绑定</span>}
        <span className="ml-auto">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line/50 bg-fill/15 px-2 py-2">
          <label className="block text-[10px] text-muted">
            笔记本
            <select
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
              value={work.binding.notebook}
              onChange={(e) => {
                const nb = e.target.value;
                onPersist({ ...work, binding: { notebook: nb, noteIds: [] } });
              }}
            >
              <option value="">选择笔记本…</option>
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
              disabled={busy}
              className="w-full rounded-md border border-line py-1 text-[11px] hover:bg-surface disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const ids = await fetchNotebookNoteIds(work.binding.notebook, getAuthHeaders());
                    onPersist({ ...work, binding: { ...work.binding, noteIds: ids } });
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? "载入中…" : "载入全部已索引笔记"}
            </button>
          ) : null}
          <p className="text-[10px] text-muted">未绑资料时将使用通识参考（默认开启）</p>
        </div>
      ) : null}
    </div>
  );
}
