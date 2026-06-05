"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  STUDIO_ASSISTANT_BODY,
  STUDIO_USER_PROMPT,
  STUDIO_USER_PROMPT_STICKY
} from "../../lib/studioOutputTypography";
import type { NotesAskSource } from "../../lib/notesAskCitation";
import type { StudioAgentTurn } from "../../lib/studioWorkTypes";
import StudioAskCitationModal from "./StudioAskCitationModal";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <span className="text-muted">…</span> }
);

export default function StudioAgentMessage({
  turn,
  streamingPhase,
  stickyUser,
  userAnchor
}: {
  turn: StudioAgentTurn;
  streamingPhase?: string;
  stickyUser?: boolean;
  userAnchor?: "active" | "history";
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
}) {
  const [citationSource, setCitationSource] = useState<NotesAskSource | null>(null);
  const sources = turn.askSources;

  if (turn.role === "user") {
    return (
      <div
        data-studio-user-anchor={userAnchor}
        className={stickyUser ? STUDIO_USER_PROMPT_STICKY : undefined}
      >
        <p className={`whitespace-pre-wrap ${STUDIO_USER_PROMPT}`}>{turn.content}</p>
      </div>
    );
  }

  const text = turn.content.trim();
  const isErrorBubble = text.startsWith("出错了：");

  return (
    <div className="py-0.5">
      {turn.streaming && streamingPhase ? (
        <p className="mb-1 text-[10px] text-brand">{streamingPhase}</p>
      ) : null}
      <div className={`${STUDIO_ASSISTANT_BODY} ${isErrorBubble ? "text-danger-ink" : "text-ink/90"}`}>
        {turn.streaming && !text ? (
          <span className="inline-block h-3 w-12 animate-pulse rounded bg-fill" aria-hidden />
        ) : text && !isErrorBubble ? (
          <NotesAskAnswerMarkdownBody
            text={text}
            sources={sources}
            onCitationClick={(index) => {
              const src = sources?.find((s) => s.index === index);
              if (src) setCitationSource(src);
            }}
          />
        ) : text ? (
          <p>{text}</p>
        ) : null}
      </div>
      <StudioAskCitationModal
        source={citationSource}
        open={Boolean(citationSource)}
        onClose={() => setCitationSource(null)}
      />
    </div>
  );
}
