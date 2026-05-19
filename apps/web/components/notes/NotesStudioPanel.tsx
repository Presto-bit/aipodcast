"use client";

import { useCallback, useState } from "react";

type Artifact = {
  id?: string;
  task?: string;
  createdAt?: string;
  markdown?: string;
  timeline?: Array<{ date?: string; event?: string; partTitle?: string }>;
};

type Props = {
  noteId?: string;
  notebook?: string;
  noteIds?: string[];
  className?: string;
};

const NOTE_TASKS = ["outline", "brief", "faq", "quiz", "timeline", "flashcards", "mindmap"] as const;
const NB_TASKS = ["outline", "brief", "faq"] as const;

const LABELS: Record<string, string> = {
  outline: "大纲",
  brief: "简报",
  faq: "FAQ",
  quiz: "测验",
  timeline: "时间线",
  flashcards: "闪卡",
  mindmap: "思维导图"
};

export function NotesStudioPanel({ noteId, notebook, noteIds = [], className }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ task: string; markdown?: string; timeline?: Artifact["timeline"] } | null>(
    null
  );
  const [error, setError] = useState("");

  const runTask = useCallback(
    async (task: string) => {
      setBusy(true);
      setError("");
      setResult(null);
      try {
        let url = "";
        let init: RequestInit = { method: "POST", credentials: "same-origin" };
        if (noteId) {
          url = `/api/notes/${encodeURIComponent(noteId)}/studio/${task}`;
          init.headers = { "content-type": "application/json" };
          init.body = "{}";
        } else if (notebook && noteIds.length > 0) {
          url = `/api/notebooks/${encodeURIComponent(notebook)}/studio/${task}`;
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify({ noteIds });
        } else {
          throw new Error("请选择资料或笔记本");
        }
        const res = await fetch(url, init);
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          markdown?: string;
          timeline?: Artifact["timeline"];
          detail?: unknown;
        };
        if (!res.ok || !data.success) {
          const d = data.detail;
          throw new Error(typeof d === "string" ? d : "生成失败");
        }
        setResult({ task, markdown: data.markdown, timeline: data.timeline });
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(false);
      }
    },
    [noteId, notebook, noteIds]
  );

  const tasks = noteId ? NOTE_TASKS : NB_TASKS;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {tasks.map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy}
            className="rounded-md border border-line bg-fill px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-surface disabled:opacity-50"
            onClick={() => void runTask(t)}
          >
            {LABELS[t] || t}
          </button>
        ))}
        {busy ? <span className="text-[11px] text-muted">生成中…</span> : null}
      </div>
      {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
      {result ? (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line/70 bg-fill/30 p-3 text-[12px] leading-relaxed">
          <p className="mb-1 text-[11px] font-medium text-muted">{LABELS[result.task] || result.task}</p>
          {result.timeline && result.timeline.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4">
              {result.timeline.map((row, i) => (
                <li key={`${row.date}-${i}`}>
                  <span className="font-medium">{row.date || "—"}</span> {row.event}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="whitespace-pre-wrap font-sans">{result.markdown || ""}</pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
