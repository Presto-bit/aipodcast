"use client";

import { useState } from "react";
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

/** 输入框内右下角：资料绑定 */
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
  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready);

  const bound =
    work.binding.notebook && work.binding.noteIds.length
      ? `${work.binding.notebook} · ${work.binding.noteIds.length}篇`
      : work.binding.notebook || undefined;

  return (
    <div data-studio-corpus-anchor="" className="inline-flex">
    <ComposerDropAnchor
      title="资料"
      controlLabel="资料"
      open={menuOpen}
      selected={Boolean(work.binding.notebook && work.binding.noteIds.length)}
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
      {work.binding.notebook ? (
        <button
          type="button"
          disabled={busy}
          className="mt-2 w-full rounded-md border border-line py-1.5 text-[11px] hover:bg-fill disabled:opacity-50"
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
      <p className="mt-2 px-1 text-[10px] text-muted">未绑资料时使用通识参考</p>
    </ComposerDropAnchor>
    </div>
  );
}
