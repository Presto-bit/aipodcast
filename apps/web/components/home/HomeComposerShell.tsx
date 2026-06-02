"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { ReactNode } from "react";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <p className="text-sm text-muted">加载回答…</p> }
);

export const COMPOSER_INPUT_MIN_H = 56;
export const COMPOSER_TOOL_H = 56;
export const COMPOSER_SIDEBAR_W = 208;
export const COMPOSER_SIDEBAR_COLLAPSED_W = 80;
export const COMPOSER_CONTENT_MAX_W = 820;
export const COMPOSER_OUTER_MAX_W = 1120;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width={28} height={28} viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

export function IconFormat() {
  return (
    <Svg>
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconNotes() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth={2}>
      <path
        d="M7 8.5h10a2 2 0 0 1 2 2v7.5a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 18V8.5z"
        strokeLinejoin="round"
      />
      <path d="M10.5 6.5v2.2a1.8 1.8 0 0 0 3.6 0V6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13h6M10 16h4.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconStyle() {
  return (
    <Svg>
      <path
        d="M8 2.5l1 3.5 3.5 1-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1 1-3.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function IconUser() {
  return (
    <Svg>
      <circle cx="8" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function IconSend() {
  return (
    <svg width={30} height={30} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3v10M8 3l4 4M8 3L4 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconNewSession() {
  return (
    <Svg>
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  );
}

/** 侧栏折叠/展开：圆角外框 + 左侧竖线（PanelLeft） */
function IconSidebarToggle() {
  return (
    <Svg>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5.5 2.5v11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
}

function IconSidebarOpen() {
  return <IconSidebarToggle />;
}

function IconSidebarClose() {
  return <IconSidebarToggle />;
}

function IconDeleteSession() {
  return (
    <Svg>
      <path d="M4.5 4.5h7M6 4.5V3.8h4V4.5M6.2 7v4.8M9.8 7v4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.2 4.5 5.8 12.2h4.4l.6-7.7" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconToolBtn({
  title,
  active,
  selected,
  onClick,
  children
}: {
  title: string;
  active?: boolean;
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={[
        "flex shrink-0 items-center justify-center rounded-full transition",
        active
          ? "bg-brand text-brand-foreground"
          : selected
            ? "border border-brand/40 bg-brand/8 text-ink"
            : "bg-fill/80 text-muted hover:bg-fill hover:text-ink"
      ].join(" ")}
      style={{ width: COMPOSER_TOOL_H, height: COMPOSER_TOOL_H, minWidth: COMPOSER_TOOL_H }}
    >
      {children}
    </button>
  );
}

export function ComposerDropMenu({
  open,
  align,
  minWidth = 148,
  children
}: {
  open: boolean;
  align: "left" | "right";
  minWidth?: number;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className={[
        "absolute z-[1100] max-h-56 overflow-y-auto rounded-[10px] border border-line bg-surface p-2 shadow-card",
        align === "left" ? "left-0" : "right-0"
      ].join(" ")}
      style={{ top: COMPOSER_TOOL_H + 6, minWidth, width: "max-content", maxWidth: 260 }}
    >
      {children}
    </div>
  );
}

export function ComposerDropAnchor({
  title,
  icon,
  open,
  selected,
  onToggle,
  align,
  minWidth,
  children
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  selected?: boolean;
  onToggle: () => void;
  align: "left" | "right";
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0 overflow-visible" style={{ width: COMPOSER_TOOL_H, height: COMPOSER_TOOL_H, zIndex: open ? 1100 : 1 }}>
      <IconToolBtn title={title} active={open} selected={selected} onClick={onToggle}>
        {icon}
      </IconToolBtn>
      <ComposerDropMenu open={open} align={align} minWidth={minWidth}>
        {children}
      </ComposerDropMenu>
    </div>
  );
}

export function ComposerStatusBar({ parts }: { parts: string[] }) {
  if (!parts.length) return null;
  return (
    <p className="mt-2 w-full border-t border-line/80 pt-2 text-xs leading-relaxed text-muted">
      {parts.join(" · ")}
    </p>
  );
}

export function ComposerCopyToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-[200] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-full bg-ink px-3.5 py-2 text-sm text-canvas shadow-lg">
      ✓ {message}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex w-full justify-end">
      <p className="max-w-[92%] whitespace-pre-wrap text-[15px] leading-[1.72] text-ink">{text}</p>
    </div>
  );
}

export type SessionListItem = { id: string; title: string; updatedAt: number };

export function sessionTimeGroup(updatedAt: number): "今天" | "昨天" | null {
  const now = new Date();
  const d = new Date(updatedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return null;
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete
}: {
  session: SessionListItem;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-0.5">
      <button
        type="button"
        className={[
          "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition",
          active ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
        ].join(" ")}
        onClick={onSelect}
      >
        {session.title || "新对话"}
      </button>
      <button
        type="button"
        title="删除对话"
        aria-label={`删除对话：${session.title || "新对话"}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition hover:bg-fill hover:text-danger-ink group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <IconDeleteSession />
      </button>
    </div>
  );
}

export function SessionHistorySidebar({
  collapsed,
  sessions,
  activeSessionId,
  onToggleCollapse,
  onNewSession,
  onSelectSession,
  onDeleteSession
}: {
  collapsed: boolean;
  sessions: SessionListItem[];
  activeSessionId: string;
  onToggleCollapse: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}) {
  if (collapsed) {
    return (
      <div
        className="flex shrink-0 flex-col gap-1 self-start pt-1"
        style={{ width: COMPOSER_SIDEBAR_COLLAPSED_W, minWidth: COMPOSER_SIDEBAR_COLLAPSED_W }}
      >
        <div className="flex items-center gap-1">
          <IconToolBtn title="展开会话栏" onClick={onToggleCollapse}>
            <IconSidebarOpen />
          </IconToolBtn>
          <IconToolBtn title="新对话" onClick={onNewSession}>
            <IconNewSession />
          </IconToolBtn>
        </div>
      </div>
    );
  }

  const groups: ("今天" | "昨天")[] = ["今天", "昨天"];

  return (
    <aside
      className="flex shrink-0 flex-col gap-2 self-stretch border-r border-line/60 pr-3"
      style={{ width: COMPOSER_SIDEBAR_W, minWidth: COMPOSER_SIDEBAR_W, minHeight: 420 }}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
          onClick={onNewSession}
        >
          新对话
        </button>
        <button
          type="button"
          title="折叠会话栏"
          aria-label="折叠会话栏"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink"
          onClick={onToggleCollapse}
        >
          <IconSidebarClose />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => {
          const items = sessions.filter((s) => sessionTimeGroup(s.updatedAt) === group);
          if (!items.length) return null;
          return (
            <div key={group} className="mb-3">
              <p className="mb-1 text-xs text-muted">{group}</p>
              <div className="space-y-0.5">
                {items.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onSelect={() => onSelectSession(s.id)}
                    onDelete={() => onDeleteSession(s.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {sessions.some((s) => !sessionTimeGroup(s.updatedAt)) ? (
          <div className="mb-3">
            <p className="mb-1 text-xs text-muted">更早</p>
            <div className="space-y-0.5">
              {sessions
                .filter((s) => !sessionTimeGroup(s.updatedAt))
                .map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId}
                    onSelect={() => onSelectSession(s.id)}
                    onDelete={() => onDeleteSession(s.id)}
                  />
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function ComposerShell({
  value,
  onChange,
  onSend,
  busy,
  menuOpen,
  formatControl,
  contextControls,
  statusBar
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  menuOpen: boolean;
  formatControl: ReactNode;
  contextControls: ReactNode;
  statusBar?: ReactNode;
}) {
  const hasText = Boolean(value.trim());
  return (
    <div
      className={[
        "relative w-full shrink-0 overflow-visible rounded-2xl border border-line bg-surface p-3 shadow-soft",
        menuOpen ? "z-30" : "z-10"
      ].join(" ")}
    >
      <div className="relative w-full overflow-visible">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="消息…"
          rows={2}
          className="w-full min-h-[56px] max-h-[min(32vh,200px)] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed text-ink outline-none ring-0 focus:outline-none focus:ring-0"
          style={{ paddingRight: hasText ? 60 : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && value.trim()) onSend();
            }
          }}
        />
        {hasText ? (
          <button
            type="button"
            title="发送"
            aria-label="发送"
            disabled={busy}
            onClick={onSend}
            className="absolute bottom-1 right-0 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-canvas transition hover:opacity-90 disabled:opacity-50"
          >
            <IconSend />
          </button>
        ) : null}
      </div>
      <div className="relative mt-1 min-h-[56px] overflow-visible" style={{ zIndex: menuOpen ? 10 : 1 }}>
        <div className="flex w-full items-center justify-between gap-1 overflow-visible">
          {formatControl}
          {contextControls}
        </div>
      </div>
      {statusBar}
    </div>
  );
}

export function PersonalProfileCard({
  open,
  hasSaved,
  personalEnabled,
  onToggleEnabled,
  onClose,
  onSave,
  fields,
  draft,
  onFieldChange
}: {
  open: boolean;
  hasSaved: boolean;
  personalEnabled: boolean;
  onToggleEnabled: () => void;
  onClose: () => void;
  onSave: () => void;
  fields: { key: string; label: string; rows: number }[];
  draft: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="relative z-10 mt-2.5 w-full shrink-0 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{hasSaved ? "编辑个人特色" : "填写个人特色"}</h2>
        <button
          type="button"
          title="关闭"
          aria-label="关闭"
          className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-fill hover:text-ink"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="max-h-[min(50vh,420px)] space-y-3 overflow-y-auto p-4">
        {hasSaved ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={personalEnabled} onChange={onToggleEnabled} />
            在本对话中使用个人特色
          </label>
        ) : null}
        {fields.map(({ key, label, rows }) => (
          <label key={key} className="block">
            <span className="text-xs font-medium text-muted">{label}</span>
            <textarea
              rows={rows}
              value={draft[key] ?? ""}
              onChange={(e) => onFieldChange(key, e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-ink outline-none focus:border-brand/40"
            />
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-fill" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:bg-brand/90"
            onClick={onSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function GeneralAnswerCard({
  streaming,
  streamingPhase,
  content,
  supplementContent,
  onCopy
}: {
  streaming?: boolean;
  streamingPhase?: string;
  content?: string;
  supplementContent?: string;
  onCopy?: () => void;
}) {
  const mainText = content?.trim() ?? "";
  const supplementText = supplementContent?.trim() ?? "";
  const phase =
    streamingPhase && !streamingPhase.includes("排队") && !streamingPhase.includes("资料已就绪")
      ? streamingPhase
      : streamingPhase?.includes("资料") || streamingPhase?.includes("就绪")
        ? "正在生成回答…"
        : streamingPhase;

  return (
    <div className="w-full min-w-0">
      {streaming && !mainText ? (
        <p className="text-sm text-muted">{phase || "正在生成回答…"}</p>
      ) : null}
      {mainText ? (
        <>
          <div className="notes-ask-answer min-w-0 [&_.notes-ask-answer-md]:max-w-none">
            <NotesAskAnswerMarkdownBody text={mainText} />
          </div>
          {onCopy && !streaming ? (
            <div className="mt-4 flex justify-end border-t border-line/50 pt-3">
              <button
                type="button"
                className="text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
                onClick={onCopy}
              >
                复制回答
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {supplementText ? (
        <section className="mt-6 border-t border-line/60 pt-4" aria-label="补充说明">
          <div className="notes-ask-answer min-w-0 [&_.notes-ask-answer-md]:max-w-none">
            <NotesAskAnswerMarkdownBody text={supplementText} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ComposerKbEmptyHint() {
  return (
    <p className="px-1 py-1 text-sm text-muted">
      还没有笔记本，{" "}
      <Link href="/notes" className="text-brand underline">
        去知识库
      </Link>
    </p>
  );
}
