"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  STUDIO_ASSISTANT_BODY,
  STUDIO_USER_PROMPT,
  STUDIO_USER_PROMPT_BOX,
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
  userAnchor,
  canEdit,
  onEditUserTurn
}: {
  turn: StudioAgentTurn;
  streamingPhase?: string;
  stickyUser?: boolean;
  userAnchor?: "active" | "history";
  canEdit?: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.content);
  const [citationSource, setCitationSource] = useState<NotesAskSource | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
        <div
          data-studio-user-anchor={userAnchor}
          className={stickyUser ? STUDIO_USER_PROMPT_STICKY : undefined}
        >
          <div className={`${STUDIO_USER_PROMPT_BOX} ring-1 ring-brand/25`}>
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
              className={`w-full resize-none overflow-hidden border-0 bg-transparent outline-none ${STUDIO_USER_PROMPT}`}
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
                const text = draft.trim();
                if (!text) {
                  cancelEdit();
                  return;
                }
                if (text !== turn.content.trim()) commitEdit();
                else cancelEdit();
              }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted">Enter 回滚并重做 · Esc 取消</p>
        </div>
      );
    }

    return (
      <div
        data-studio-user-anchor={userAnchor}
        className={stickyUser ? STUDIO_USER_PROMPT_STICKY : undefined}
      >
        <div
          role={editable ? "button" : undefined}
          tabIndex={editable ? 0 : undefined}
          className={[
            STUDIO_USER_PROMPT_BOX,
            editable ? "cursor-text hover:ring-1 hover:ring-brand/20" : ""
          ].join(" ")}
          onClick={() => {
            if (!editable) return;
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (!editable) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          <p className={`whitespace-pre-wrap ${STUDIO_USER_PROMPT}`}>{turn.content}</p>
        </div>
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
