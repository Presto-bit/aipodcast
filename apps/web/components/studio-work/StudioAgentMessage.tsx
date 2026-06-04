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
  const intent = turn.intent;

  return (
    <div className="rounded-lg border border-transparent py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium text-muted">解释</span>
        {intent ? (
          <span className="rounded-full bg-fill/80 px-2 py-0.5 text-[10px] text-muted">
            {studioAgentIntentLabel(intent)}
          </span>
        ) : null}
        {turn.streaming && streamingPhase ? (
          <span className="text-[10px] text-brand">{streamingPhase}</span>
        ) : null}
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
