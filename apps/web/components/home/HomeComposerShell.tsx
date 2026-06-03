"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FEATURE_CORE_FIELDS } from "../../lib/homeComposerPersonalFields";

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

export function IconExpert() {
  return (
    <Svg>
      <path
        d="M8 2.5l1.2 2.4 2.6.4-1.9 1.8.45 2.6L8 8.6 5.65 9.7l.45-2.6L4.2 5.3l2.6-.4L8 2.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M4.5 12.5h7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </Svg>
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
  dashed,
  badgeDot,
  onClick,
  children
}: {
  title: string;
  active?: boolean;
  selected?: boolean;
  dashed?: boolean;
  badgeDot?: boolean;
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
        "relative flex shrink-0 items-center justify-center rounded-full transition",
        dashed
          ? "border border-dashed border-brand/45 bg-transparent text-muted hover:border-brand/70 hover:text-ink"
          : active
            ? "bg-brand text-brand-foreground"
            : selected
              ? "border border-brand/40 bg-brand/8 text-ink"
              : "bg-fill/80 text-muted hover:bg-fill hover:text-ink"
      ].join(" ")}
      style={{ width: COMPOSER_TOOL_H, height: COMPOSER_TOOL_H, minWidth: COMPOSER_TOOL_H }}
    >
      {children}
      {badgeDot ? (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-surface"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

const COMPOSER_DROP_GAP = 6;

function composerDropMaxHeight(): number {
  return Math.min(384, window.innerHeight * 0.52);
}

function computeComposerDropPos(
  rect: DOMRect,
  align: "left" | "right"
): { top?: number; bottom?: number; left?: number; right?: number; maxHeight: number } {
  const maxMenuH = composerDropMaxHeight();
  const spaceBelow = window.innerHeight - rect.bottom - COMPOSER_DROP_GAP;
  const spaceAbove = rect.top - COMPOSER_DROP_GAP;
  const openUpward = spaceBelow < maxMenuH && spaceAbove > spaceBelow;
  const available = openUpward ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(120, Math.min(maxMenuH, available - 8));

  if (openUpward) {
    return {
      bottom: window.innerHeight - rect.top + COMPOSER_DROP_GAP,
      maxHeight,
      ...(align === "left" ? { left: rect.left } : { right: window.innerWidth - rect.right })
    };
  }
  return {
    top: rect.bottom + COMPOSER_DROP_GAP,
    maxHeight,
    ...(align === "left" ? { left: rect.left } : { right: window.innerWidth - rect.right })
  };
}

export function ComposerDropMenu({
  open,
  align,
  minWidth = 148,
  anchorRef,
  children
}: {
  open: boolean;
  align: "left" | "right";
  minWidth?: number;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      setPos(computeComposerDropPos(el.getBoundingClientRect(), align));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align, anchorRef, children]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      data-composer-dropdown=""
      className="fixed z-[2000] overflow-y-auto rounded-[10px] border border-line bg-surface p-2 shadow-card"
      style={{
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.right,
        minWidth,
        width: "max-content",
        maxWidth: 320,
        maxHeight: pos.maxHeight
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function ComposerDropAnchor({
  title,
  icon,
  open,
  selected,
  chipLabel,
  onToggle,
  align,
  minWidth,
  children
}: {
  title: string;
  icon: ReactNode;
  open: boolean;
  selected?: boolean;
  /** 选中态在按钮上展示的短标签（如专家名） */
  chipLabel?: string;
  onToggle: () => void;
  align: "left" | "right";
  minWidth?: number;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const showChip = Boolean(chipLabel?.trim());
  return (
    <div
      ref={anchorRef}
      className="relative shrink-0 overflow-visible"
      style={{ height: COMPOSER_TOOL_H, zIndex: open ? 1100 : 1 }}
    >
      {showChip ? (
        <button
          type="button"
          title={title}
          aria-label={chipLabel ? `${title}：${chipLabel}` : title}
          aria-expanded={open}
          onClick={onToggle}
          className={[
            "flex h-14 max-w-[9.5rem] items-center gap-1 rounded-full border px-2 transition",
            open
              ? "border-brand bg-brand/10 text-ink"
              : selected
                ? "border-brand/45 bg-brand/8 text-ink"
                : "border-line/60 bg-fill/80 text-muted hover:border-line hover:bg-fill hover:text-ink"
          ].join(" ")}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center">{icon}</span>
          <span className="min-w-0 truncate text-xs font-medium">{chipLabel}</span>
        </button>
      ) : (
        <IconToolBtn title={title} active={open} selected={selected} onClick={onToggle}>
          {icon}
        </IconToolBtn>
      )}
      <ComposerDropMenu open={open} align={align} minWidth={minWidth} anchorRef={anchorRef}>
        {children}
      </ComposerDropMenu>
    </div>
  );
}

const WORKFLOW_PILL: Record<string, string> = {
  chat: "border-line bg-fill/40 text-muted",
  standby: "border-line bg-fill/40 text-muted",
  resolution: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
  executing: "border-brand/40 bg-brand/10 text-brand",
  review: "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
};

export function ComposerStatusBar({
  parts,
  workflowLabel,
  workflowPhase
}: {
  parts: string[];
  workflowLabel?: string;
  workflowPhase?: string;
}) {
  if (!parts.length && !workflowLabel) return null;
  const pillClass = WORKFLOW_PILL[workflowPhase ?? "chat"] ?? WORKFLOW_PILL.chat;
  return (
    <div className="mt-2 w-full border-t border-line/80 pt-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted">
        {workflowLabel ? (
          <span
            className={[
              "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              pillClass
            ].join(" ")}
          >
            {workflowLabel}
          </span>
        ) : null}
        {parts.length ? <span>{parts.join(" · ")}</span> : null}
      </p>
    </div>
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
      <div className="max-w-[92%] rounded-2xl border border-line/70 bg-fill/25 px-4 py-3 shadow-soft">
        <p className="whitespace-pre-wrap text-[15px] leading-[1.72] text-ink">{text}</p>
      </div>
    </div>
  );
}

export type SessionListItem = { id: string; title: string; updatedAt: number; empty: boolean };

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
      {!session.empty ? (
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
      ) : null}
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
        className="flex shrink-0 flex-col gap-1 self-stretch bg-surface/40 py-3 pl-2 pr-1"
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
      className="flex shrink-0 flex-col gap-2 self-stretch border-r border-line/60 bg-surface/40 py-3 pl-3 pr-2"
      style={{ width: COMPOSER_SIDEBAR_W, minWidth: COMPOSER_SIDEBAR_W }}
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
  statusBar,
  placeholder = "消息…",
  sendDisabled = false
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  menuOpen: boolean;
  formatControl: ReactNode;
  contextControls: ReactNode;
  statusBar?: ReactNode;
  placeholder?: string;
  sendDisabled?: boolean;
}) {
  const hasText = Boolean(value.trim());
  const canSend = hasText && !busy && !sendDisabled;
  return (
    <div
      className={[
        "relative w-full shrink-0 overflow-visible rounded-2xl border border-line bg-surface p-3 shadow-soft",
        menuOpen ? "z-40" : "z-20"
      ].join(" ")}
    >
      <div className="relative w-full overflow-visible">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full min-h-[56px] max-h-[min(32vh,200px)] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed text-ink outline-none ring-0 focus:outline-none focus:ring-0"
          style={{ paddingRight: hasText ? 60 : 0 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {hasText ? (
          <button
            type="button"
            title="发送"
            aria-label="发送"
            disabled={!canSend}
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
  return (
    <FeatureProfilePanel
      open={open}
      hasSaved={hasSaved}
      personalEnabled={personalEnabled}
      onToggleEnabled={onToggleEnabled}
      onClose={onClose}
      onSave={onSave}
      supplementalFields={fields}
      supplementalDraft={draft}
      onSupplementalFieldChange={onFieldChange}
      featureCore={{ who: "", remember: "", avoid: "" }}
      onFeatureCoreChange={() => undefined}
    />
  );
}

function PersonalFeatureField({
  label,
  rows,
  placeholder,
  value,
  onChange
}: {
  label: string;
  rows: number;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium leading-snug text-ink">{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-ink outline-none placeholder:text-muted/80 focus:border-brand/40"
      />
    </label>
  );
}

export function FeatureProfilePanel({
  open,
  hasSaved,
  personalEnabled,
  onToggleEnabled,
  onClose,
  onSave,
  featureCore,
  onFeatureCoreChange,
  supplementalFields,
  supplementalDraft,
  onSupplementalFieldChange,
  placement = "bottom"
}: {
  open: boolean;
  hasSaved: boolean;
  personalEnabled: boolean;
  onToggleEnabled: () => void;
  onClose: () => void;
  onSave: () => void;
  featureCore: { who: string; remember: string; avoid: string };
  onFeatureCoreChange: (key: "who" | "remember" | "avoid", value: string) => void;
  supplementalFields: { key: string; label: string; rows: number; placeholder?: string }[];
  supplementalDraft: Record<string, string>;
  onSupplementalFieldChange: (key: string, value: string) => void;
  /** 输入框贴底时向上展开，避免被视口裁切 */
  placement?: "top" | "bottom";
}) {
  const [supplementOpen, setSupplementOpen] = useState(false);
  if (!open) return null;

  return (
    <div
      className={[
        "relative z-30 w-full shrink-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft",
        placement === "bottom" ? "mt-2.5" : ""
      ].join(" ")}
    >
      <div className="flex items-center justify-between border-b border-line/80 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{hasSaved ? "编辑我的特色" : "填写我的特色 · 我是谁"}</h2>
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
      <div className="max-h-[min(58vh,480px)] space-y-3 overflow-y-auto p-4">
        <p className="rounded-lg bg-fill/60 px-3 py-2 text-xs leading-relaxed text-muted">
          共 14 题：先完成核心三问（必填），补充题填了会更像你。换专家也不变。
          <br />
          写作习惯 — 句式、结构。在「写作习惯 ▾」里随时换。
        </p>
        {hasSaved ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={personalEnabled} onChange={onToggleEnabled} />
            在本对话中使用我的特色
          </label>
        ) : null}
        <p className="text-xs font-medium text-muted">核心三问（必填）</p>
        {FEATURE_CORE_FIELDS.map(({ key, label, placeholder, rows }) => (
          <PersonalFeatureField
            key={key}
            label={label}
            rows={rows}
            placeholder={placeholder}
            value={featureCore[key]}
            onChange={(value) => onFeatureCoreChange(key, value)}
          />
        ))}
        <div className="border-t border-line/70 pt-2">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-xs font-medium text-muted hover:text-ink"
            onClick={() => setSupplementOpen((v) => !v)}
          >
            <span>补充 11 题，可选</span>
            <span aria-hidden>{supplementOpen ? "▴" : "▾"}</span>
          </button>
          {supplementOpen ? (
            <div className="mt-2 space-y-3">
              <p className="text-xs text-muted">第 4–14 题，填了会更像你，不填也能用。</p>
              {supplementalFields.map(({ key, label, rows, placeholder }) => (
                <PersonalFeatureField
                  key={key}
                  label={label}
                  rows={rows}
                  placeholder={placeholder}
                  value={supplementalDraft[key] ?? ""}
                  onChange={(value) => onSupplementalFieldChange(key, value)}
                />
              ))}
            </div>
          ) : null}
        </div>
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
