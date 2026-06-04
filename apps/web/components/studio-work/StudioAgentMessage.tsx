"use client";

import dynamic from "next/dynamic";
import { studioAgentIntentLabel } from "../../lib/studioAgentAsk";
import type { StudioAgentTurn } from "../../lib/studioWorkTypes";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <span className="text-muted">…</span> }
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
      <div className="flex justify-end">
        <p className="max-w-[90%] whitespace-pre-wrap rounded-lg bg-fill/50 px-2.5 py-1 text-[12px] leading-relaxed text-ink">
          {turn.content}
        </p>
      </div>
    );
  }

  const text = turn.content.trim();
  const label = turn.intent ? studioAgentIntentLabel(turn.intent) : "Agent";

  return (
    <div className="py-0.5">
      <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted">
        <span className="font-medium text-brand">{label}</span>
        {turn.streaming && streamingPhase ? <span>{streamingPhase}</span> : null}
      </div>
      <div className="text-[12px] leading-relaxed text-ink">
        {turn.streaming && !text ? (
          <span className="inline-block h-3 w-12 animate-pulse rounded bg-fill" aria-hidden />
        ) : text ? (
          <NotesAskAnswerMarkdownBody text={text} />
        ) : null}
      </div>
    </div>
  );
}
