"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { studioAgentIntentLabel } from "../../lib/studioAgentAsk";
import {
  STUDIO_ASSISTANT_BODY,
  STUDIO_USER_BUBBLE
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
  canEdit,
  onEditUserTurn,
  onRollbackFromTurn
}: {
  turn: StudioAgentTurn;
  streamingPhase?: string;
  canEdit: boolean;
  onEditUserTurn?: (turnId: string, newText: string) => void;
  onRollbackFromTurn?: (turnId: string) => void;
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

  function handleBlur() {
    const text = draft.trim();
    if (!text) {
      cancelEdit();
      return;
    }
    if (text !== turn.content.trim()) commitEdit();
    else cancelEdit();
  }

  if (turn.role === "user") {
    const editable = canEdit && !turn.streaming && Boolean(onEditUserTurn);
    const showRollback = editable && onRollbackFromTurn;

    if (editing && editable) {
      return (
        <div className="flex justify-end">
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
            className="max-w-[90%] min-w-[8rem] resize-none overflow-hidden whitespace-pre-wrap rounded-lg border border-brand/35 bg-fill/50 px-2.5 py-1 text-[12px] leading-relaxed text-ink outline-none ring-1 ring-brand/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            onBlur={() => handleBlur()}
          />
          <p className="mt-1 text-right text-[10px] text-muted">Enter 发送 · Esc 取消</p>
        </div>
      );
    }

    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[90%]">
          {editable ? (
            <div className="mb-0.5 flex justify-end gap-2 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                className="text-[10px] text-muted hover:text-brand"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEditing(true)}
              >
                编辑
              </button>
              {showRollback ? (
                <button
                  type="button"
                  className="text-[10px] text-muted hover:text-danger-ink"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onRollbackFromTurn!(turn.id)}
                  title="删除本条及之后对话"
                >
                  回滚
                </button>
              ) : null}
            </div>
          ) : null}
          <p
            role={editable ? "button" : undefined}
            tabIndex={editable ? 0 : undefined}
            className={[
              `whitespace-pre-wrap rounded-lg bg-fill/50 px-2.5 py-1 ${STUDIO_USER_BUBBLE}`,
              editable ? "cursor-text hover:ring-1 hover:ring-brand/25" : ""
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
            {turn.content}
          </p>
        </div>
      </div>
    );
  }

  const text = turn.content.trim();
  const intent = turn.intent;
  const isErrorBubble = text.startsWith("出错了：");

  return (
    <div className="rounded-lg border border-transparent py-0.5">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium text-muted">解释</span>
        {intent && !isErrorBubble ? (
          <span className="rounded-full bg-fill/80 px-2 py-0.5 text-[10px] text-muted">
            {studioAgentIntentLabel(intent)}
          </span>
        ) : null}
        {turn.streaming && streamingPhase ? (
          <span className="text-[10px] text-brand">{streamingPhase}</span>
        ) : null}
      </div>
      <div className={`${STUDIO_ASSISTANT_BODY} ${isErrorBubble ? "text-danger-ink" : "text-ink"}`}>
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
