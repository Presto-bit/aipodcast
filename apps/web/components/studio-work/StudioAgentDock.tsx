"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  buildStudioAgentQuestion,
  studioTurnsToMemoryTurns,
  suggestBriefFromTurns
} from "../../lib/studioAgentAsk";
import { featureCoreToPrompt } from "../../lib/homeComposerFeatureCore";
import { streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import type { StudioAgentTurn, StudioWork, WorkStatus } from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioAgentMessage from "./StudioAgentMessage";

const QUICK_PROMPTS = [
  "我想写一篇清单体小红书，受众是产品新人",
  "帮我问清楚：语气要多犀利、要不要提竞品",
  "我已绑资料，建议怎么写开头钩子"
] as const;

const PANEL_MIN = 140;
const PANEL_MAX = 520;
const PANEL_DEFAULT = 300;

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "生成中…";
  if (status === "ready" || status === "shipped") {
    return "Ask Agent — 解释结构、资料依据；改稿请用上方改版框";
  }
  return "Ask Agent — 描述想写的笔记，我会追问澄清…";
}

export default function StudioAgentDock({
  work,
  isLoggedIn,
  ready,
  parentBusy,
  getAuthHeaders,
  onPersist,
  onWriteBrief,
  onGeneratePlan,
  expanded = true
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  parentBusy: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  onWriteBrief: (brief: string) => void;
  onGeneratePlan: () => void | Promise<void>;
  /** 移动端全屏 Agent 时拉高面板 */
  expanded?: boolean;
}) {
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(expanded ? PANEL_DEFAULT : 220);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const turns = work.agentTurns ?? [];
  const readOnly = work.status === "generating" || parentBusy;
  const canChat = isLoggedIn && ready && !readOnly;

  useEffect(() => {
    if (expanded) setPanelHeight(PANEL_DEFAULT);
  }, [expanded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, turns[turns.length - 1]?.content, collapsed]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onResizeMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    setPanelHeight(Math.min(PANEL_MAX, Math.max(PANEL_MIN, drag.startH + delta)));
  }, []);

  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }

  function patchTurns(nextTurns: StudioAgentTurn[], sessionState = work.agentSessionState ?? null) {
    onPersist({ ...work, agentTurns: nextTurns, agentSessionState: sessionState });
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat || agentBusy) return;

    const userTurn: StudioAgentTurn = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      createdAt: Date.now()
    };
    const assistantId = crypto.randomUUID();
    const streamingTurn: StudioAgentTurn = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      streaming: true
    };
    const baseTurns = [...turns, userTurn, streamingTurn];
    patchTurns(baseTurns);
    setInput("");
    setCollapsed(false);
    setAgentBusy(true);
    setPhase("");

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const memoryFromStudio = studioTurnsToMemoryTurns([...turns, userTurn]);
    const hasCorpus = Boolean(work.binding.notebook.trim() && work.binding.noteIds.length > 0);
    const mode = hasCorpus ? ("rag" as const) : ("general" as const);

    let answerBuf = "";
    let supplementBuf = "";

    try {
      const done = await streamHomeComposerAsk({
        question: buildStudioAgentQuestion(work, q),
        mode,
        notebook: work.binding.notebook,
        noteIds: work.binding.noteIds,
        memoryTurns: memoryFromStudio,
        sessionState: work.agentSessionState ?? null,
        authorIpPrompt: featureCoreToPrompt(work.featureCore),
        authHeaders: getAuthHeaders(),
        signal: ac.signal,
        callbacks: {
          onPhase: (msg) => setPhase(msg),
          onChunk: (text, role, section) => {
            if (role === "reasoning") return;
            if (section === "supplement") supplementBuf += text;
            else answerBuf += text;
            const content = answerBuf.trim() || supplementBuf.trim();
            patchTurns(
              baseTurns.map((t) =>
                t.id === assistantId ? { ...t, content, streaming: true } : t
              )
            );
          }
        }
      });

      const finalContent =
        done.answer.trim() ||
        supplementBuf.trim() ||
        answerBuf.trim() ||
        "（暂无回复）";

      patchTurns(
        baseTurns.map((t) =>
          t.id === assistantId
            ? { ...t, content: finalContent, streaming: false }
            : t
        ),
        done.sessionState
      );
    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = String(err instanceof Error ? err.message : err);
      patchTurns(
        baseTurns.map((t) =>
          t.id === assistantId
            ? { ...t, content: `出错了：${msg}`, streaming: false }
            : t
        )
      );
    } finally {
      setAgentBusy(false);
      setPhase("");
      abortRef.current = null;
    }
  }

  function handleWriteBrief() {
    const draft = suggestBriefFromTurns(work, turns);
    if (!draft.trim()) return;
    onWriteBrief(draft);
  }

  const showBriefActions =
    (work.status === "briefing" || work.status === "planned") && !readOnly;
  const suggestedBrief = suggestBriefFromTurns(work, turns);
  const canWriteBrief = Boolean(suggestedBrief.trim());
  const threadHeight = collapsed ? 0 : panelHeight;

  const footerActions =
    showBriefActions && turns.some((t) => t.role === "assistant" && !t.streaming) ? (
      <>
        <button
          type="button"
          disabled={!canWriteBrief}
          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] hover:bg-fill disabled:opacity-50"
          onClick={handleWriteBrief}
        >
          写入 Brief
        </button>
        <button
          type="button"
          disabled={agentBusy || parentBusy || !work.brief.trim()}
          className="rounded-lg bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-foreground disabled:opacity-50"
          onClick={() => void onGeneratePlan()}
        >
          生成计划
        </button>
      </>
    ) : null;

  return (
    <div
      className={[
        "flex min-h-0 shrink-0 flex-col border-t border-line bg-[color-mix(in_srgb,var(--color-fill)_35%,var(--color-surface))]",
        expanded ? "flex-1 lg:flex-none" : ""
      ].join(" ")}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line/70 px-3">
        <button
          type="button"
          className="h-1 w-8 shrink-0 cursor-ns-resize rounded-full bg-line hover:bg-muted"
          aria-label="拖拽调整 Agent 面板高度"
          onMouseDown={startResize}
        />
        <span className="text-xs font-medium text-ink">Agent</span>
        <span className="rounded-md bg-fill px-1.5 py-0.5 text-[10px] text-muted">
          {work.status === "briefing" || work.status === "planned" ? "需求澄清" : "助手"}
        </span>
        {phase ? <span className="truncate text-[10px] text-brand">{phase}</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {turns.length > 0 ? (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[10px] text-muted hover:bg-fill hover:text-ink"
              onClick={() => patchTurns([])}
            >
              清空
            </button>
          ) : null}
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[10px] text-muted hover:bg-fill hover:text-ink"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 overflow-y-auto px-3 transition-[height] duration-150"
        style={{ height: threadHeight }}
        hidden={collapsed}
      >
        {turns.length === 0 ? (
          <div className="py-3">
            <p className="text-xs text-muted">从下方输入开始，或用快捷提示：</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!canChat}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[11px] text-ink hover:border-brand/40 hover:bg-brand/5 disabled:opacity-50"
                  onClick={() => {
                    setInput(p);
                    void handleSend(p);
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl py-2">
            {turns.map((turn) => (
              <StudioAgentMessage
                key={turn.id}
                turn={turn}
                streamingPhase={turn.streaming ? phase : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-3">
        {!isLoggedIn && ready ? (
          <p className="mb-2 text-center text-xs text-warning-ink">
            <Link href="/login" className="text-brand underline">
              登录
            </Link>
            后可使用 Agent
          </p>
        ) : null}
        <StudioAgentComposer
          work={work}
          value={input}
          onChange={setInput}
          onSend={() => void handleSend()}
          busy={agentBusy}
          disabled={!canChat}
          placeholder={agentPlaceholder(work.status)}
          footerActions={footerActions}
        />
      </div>
    </div>
  );
}
