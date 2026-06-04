"use client";

import dynamic from "next/dynamic";
import type { StudioAgentTurn } from "../../lib/studioWorkTypes";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <p className="text-sm text-muted">…</p> }
);

export default function StudioAgentMessage({
  turn,
  streamingPhase
}: {
  turn: StudioAgentTurn;
  streamingPhase?: string;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end py-1">
        <div className="max-w-[85%] rounded-xl bg-fill/60 px-3 py-2 text-[13px] leading-relaxed text-ink">
          <p className="whitespace-pre-wrap">{turn.content}</p>
        </div>
      </div>
    );
  }

  const text = turn.content.trim();
  const streaming = turn.streaming;

  return (
    <div className="group py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand/10 text-[10px] font-semibold text-brand">
          A
        </span>
        <span className="text-[11px] font-medium text-muted">Agent</span>
        {streaming && streamingPhase ? (
          <span className="text-[11px] text-brand">{streamingPhase}</span>
        ) : null}
      </div>
      <div className="pl-7 text-[13px] leading-relaxed text-ink">
        {streaming && !text ? (
          <span className="inline-block h-4 w-4 animate-pulse rounded bg-fill" aria-hidden />
        ) : text ? (
          <NotesAskAnswerMarkdownBody text={text} />
        ) : null}
      </div>
    </div>
  );
}
