"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerDropAnchor } from "../home/HomeComposerShell";
import { useNotebooksHubQuery } from "../../lib/queries/notebooksQueries";
import { getStudioWork, patchStudioWork } from "../../lib/studioWorkStorage";
import { STUDIO_CORPUS_MAX_NOTE_IDS } from "../../lib/studioAskPhase";
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

function sameNoteIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map((id) => id.trim()).filter(Boolean).sort();
  const sb = [...b].map((id) => id.trim()).filter(Boolean).sort();
  return sa.every((id, i) => id === sb[i]);
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
  const workIdRef = useRef(work.id);
  const onPersistRef = useRef(onPersist);
  const getAuthHeadersRef = useRef(getAuthHeaders);
  workIdRef.current = work.id;
  onPersistRef.current = onPersist;
  getAuthHeadersRef.current = getAuthHeaders;
  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready);

  const notebook = work.binding.notebook.trim();
  const noteCount = work.binding.noteIds.length;

  useEffect(() => {
    if (!notebook || !isLoggedIn || !ready) return;
    const workId = workIdRef.current;
    const existing = getStudioWork(workId);
    if (
      existing &&
      existing.binding.notebook.trim() === notebook &&
      existing.binding.noteIds.length > 0
    ) {
      return;
    }

    const gen = ++loadGenRef.current;
    setBusy(true);
    void (async () => {
      try {
        const ids = await fetchNotebookNoteIds(notebook, getAuthHeadersRef.current());
        if (loadGenRef.current !== gen) return;
        const capped = ids.slice(0, STUDIO_CORPUS_MAX_NOTE_IDS);
        const latest = getStudioWork(workId);
        if (
          latest &&
          latest.binding.notebook.trim() === notebook &&
          sameNoteIdSet(latest.binding.noteIds, capped)
        ) {
          return;
        }
        const patched = patchStudioWork(workId, { binding: { notebook, noteIds: capped } });
        if (patched) onPersistRef.current(patched);
      } finally {
        if (loadGenRef.current === gen) setBusy(false);
      }
    })();
  }, [notebook, isLoggedIn, ready]);

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
              const next = patchStudioWork(work.id, { binding: { notebook: nb, noteIds: [] } });
              if (next) onPersist(next);
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
