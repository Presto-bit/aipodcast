"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerDropAnchor } from "../home/HomeComposerShell";
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

/** 输入框内右下角：资料绑定（选笔记本后自动载入笔记） */
export default function StudioCorpusBar({
  work,
  isLoggedIn,
  ready,
  getAuthHeaders,
  onPersist,
  menuOpen,
  onMenuOpenChange
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const loadGenRef = useRef(0);
  const workRef = useRef(work);
  workRef.current = work;
  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready);

  const notebook = work.binding.notebook.trim();
  const noteCount = work.binding.noteIds.length;

  useEffect(() => {
    if (!notebook || !isLoggedIn || !ready) return;
    const gen = ++loadGenRef.current;
    setBusy(true);
    void (async () => {
      try {
        const ids = await fetchNotebookNoteIds(notebook, getAuthHeaders());
        if (loadGenRef.current !== gen) return;
        const cur = workRef.current;
        onPersist({ ...cur, binding: { notebook, noteIds: ids } });
      } finally {
        if (loadGenRef.current === gen) setBusy(false);
      }
    })();
  }, [notebook, isLoggedIn, ready, getAuthHeaders, onPersist]);

  const bound =
    notebook && noteCount
      ? `${notebook} · ${noteCount}篇`
      : notebook
        ? busy
          ? `${notebook} · 载入中…`
          : notebook
        : undefined;

  return (
    <div data-studio-corpus-anchor="" className="inline-flex">
      <ComposerDropAnchor
        title="资料"
        controlLabel="资料"
        open={menuOpen}
        selected={Boolean(notebook && noteCount)}
        chipLabel={bound}
        onToggle={() => onMenuOpenChange(!menuOpen)}
        align="right"
        minWidth={220}
      >
        <label className="block px-1 pb-1 text-[10px] text-muted">
          笔记本
          <select
            className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
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
        {notebook ? (
          <p className="mt-2 px-1 text-[10px] text-muted">
            {busy ? "正在载入该笔记本下的笔记…" : noteCount ? `已载入 ${noteCount} 篇` : "暂无可载入笔记"}
          </p>
        ) : null}
      </ComposerDropAnchor>
    </div>
  );
}
