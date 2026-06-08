"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { STUDIO_ASSISTANT_BODY, STUDIO_USER_PROMPT } from "../../lib/studioOutputTypography";

const STUDIO_USER_RING = "rounded-lg px-3 py-2 ring-1 ring-line/55";
const STUDIO_USER_RING_EDIT = "rounded-lg px-3 py-2 ring-1 ring-brand/40";
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
  userAnchor,
  canEdit,
  onEditUserTurn,
  onSuggestedReply
}: {
  turn: StudioAgentTurn;
  streamingPhase?: string;
  userAnchor?: "active" | "history";
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
  onSuggestedReply?: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.content);
  const [citationSource, setCitationSource] = useState<NotesAskSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const skipBlurRef = useRef(false);
  const sources = turn.askSources;

  useEffect(() => {
    if (!editing) setDraft(turn.content);
  }, [turn.content, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  function commitEdit() {
    const text = draft.trim();
    if (!text || !onEditUserTurn) return;
    skipBlurRef.current = true;
    if (text === turn.content.trim()) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onEditUserTurn(turn.id, text);
  }

  function cancelEdit() {
    setDraft(turn.content);
    setEditing(false);
  }

  if (turn.role === "user") {
    const editable = Boolean(canEdit && !turn.streaming && onEditUserTurn);

    if (editing && editable) {
      return (
        <div data-studio-user-anchor={userAnchor} className={STUDIO_USER_RING_EDIT}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            rows={1}
            className={`w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none ring-0 focus:outline-none focus:ring-0 ${STUDIO_USER_PROMPT}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onBlur={() => {
              if (skipBlurRef.current) {
                skipBlurRef.current = false;
                return;
              }
              cancelEdit();
            }}
          />
        </div>
      );
    }

    return (
      <div data-studio-user-anchor={userAnchor} className={STUDIO_USER_RING}>
        <p
          className={`whitespace-pre-wrap ${STUDIO_USER_PROMPT} ${editable ? "cursor-text" : ""}`}
          onClick={() => {
            if (!editable) return;
            setEditing(true);
          }}
        >
          {turn.content}
        </p>
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
            expandCodeBlocks
            onCitationClick={(index) => {
              const src = sources?.find((s) => s.index === index);
              if (src) setCitationSource(src);
            }}
          />
        ) : text ? (
          <p>{text}</p>
        ) : null}
      </div>
      {turn.suggestedReplies?.length && onSuggestedReply && !turn.streaming ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {turn.suggestedReplies.map((chip) => (
            <button
              key={chip}
              type="button"
              className="rounded-full border border-line/70 bg-fill/40 px-2.5 py-1 text-[11px] text-ink/90 transition hover:border-brand/40 hover:bg-brand/5"
              onClick={() => onSuggestedReply(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      <StudioAskCitationModal
        source={citationSource}
        open={Boolean(citationSource)}
        onClose={() => setCitationSource(null)}
      />
    </div>
  );
}
