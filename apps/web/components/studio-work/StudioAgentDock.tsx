"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  buildStudioAgentQuestion,
  inferStudioAgentIntent,
  mergeBriefIntoWork,
  studioAgentIntentLabel,
  studioTurnsToMemoryTurns,
  suggestBriefFromTurns
} from "../../lib/studioAgentAsk";
import { featureCoreToPrompt } from "../../lib/homeComposerFeatureCore";
import { mergeVoiceIntoWork, voiceProgressLabel } from "../../lib/studioVoiceFromChat";
import { streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import type { StudioAgentIntent, StudioAgentTurn, StudioWork, WorkStatus } from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioAgentMessage from "./StudioAgentMessage";
import StudioAgentTaskPins from "./StudioAgentTaskPins";

const QUICK_PROMPTS = [
  "我想写一篇清单体小红书，受众是产品新人",
  "这篇笔记发布节奏和互动策略怎么定",
  "帮我定一下 Voice：我是谁、读者该记住什么"
] as const;

const PANEL_MIN = 120;
const PANEL_MAX = 420;
const PANEL_DEFAULT = 240;

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "生成中…";
  if (status === "ready" || status === "shipped") {
    return "问运营、解读稿件，或说改版意见…";
  }
  return "描述本篇小红书想写什么…";
}

export default function StudioAgentDock({
  work,
  isLoggedIn,
  ready,
  parentBusy,
  getAuthHeaders,
  onPersist,
  onGeneratePlan,
  onConfirmGenerate,
  primary = false
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  parentBusy: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  onGeneratePlan?: () => void | Promise<void>;
  onConfirmGenerate?: () => void | Promise<void>;
  /** Agent 为主工作区（Cursor 心智） */
  primary?: boolean;
}) {
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [activeIntent, setActiveIntent] = useState<StudioAgentIntent | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(PANEL_DEFAULT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const turns = work.agentTurns ?? [];
  const readOnly = work.status === "generating" || parentBusy;
  const canChat = isLoggedIn && ready && !readOnly;
  const canPlan = Boolean(suggestBriefFromTurns(work, turns).trim() || work.brief.trim());

  useEffect(() => {
    if (!collapsed) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [turns.length, turns[turns.length - 1]?.content, collapsed, work.brief, work.plan]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (primary) return;
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY;
    setPanelHeight(Math.min(PANEL_MAX, Math.max(PANEL_MIN, drag.startH + delta)));
  }, [primary]);

  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);

  function startResize(e: React.MouseEvent) {
    if (primary) return;
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: panelHeight };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }

  function applyDialogExtract(
    nextTurns: StudioAgentTurn[],
    sessionState: typeof work.agentSessionState = work.agentSessionState ?? null
  ) {
    let next: StudioWork = {
      ...work,
      agentTurns: nextTurns,
      agentSessionState: sessionState ?? null
    };
    const withBrief = mergeBriefIntoWork(next, nextTurns);
    if (withBrief) next = withBrief;
    const withVoice = mergeVoiceIntoWork(next, nextTurns);
    if (withVoice) next = withVoice;
    onPersist(next);
  }

  function patchTurnsStreaming(nextTurns: StudioAgentTurn[]) {
    onPersist({ ...work, agentTurns: nextTurns });
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat || agentBusy) return;

    const intent = inferStudioAgentIntent(q, work);
    setActiveIntent(intent);

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
      streaming: true,
      intent
    };
    const baseTurns = [...turns, userTurn, streamingTurn];
    applyDialogExtract(baseTurns);
    setInput("");
    setCollapsed(false);
    setAgentBusy(true);
    setPhase("");

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const memoryFromStudio = studioTurnsToMemoryTurns([...turns, userTurn]);
    const hasCorpus = Boolean(work.binding.notebook.trim() && work.binding.noteIds.length > 0);
    const ragMode = hasCorpus ? ("rag" as const) : ("general" as const);

    let answerBuf = "";
    let supplementBuf = "";

    try {
      const done = await streamHomeComposerAsk({
        question: buildStudioAgentQuestion(work, q, intent),
        mode: ragMode,
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
            patchTurnsStreaming(
              baseTurns.map((t) =>
                t.id === assistantId ? { ...t, content, streaming: true, intent } : t
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

      const finalTurns = baseTurns.map((t) =>
        t.id === assistantId
          ? { ...t, content: finalContent, streaming: false, intent }
          : t
      );
      applyDialogExtract(finalTurns, done.sessionState);
    } catch (err) {
      if (ac.signal.aborted) return;
      const msg = String(err instanceof Error ? err.message : err);
      applyDialogExtract(
        baseTurns.map((t) =>
          t.id === assistantId
            ? { ...t, content: `出错了：${msg}`, streaming: false, intent }
            : t
        )
      );
    } finally {
      setAgentBusy(false);
      setPhase("");
      abortRef.current = null;
    }
  }

  const modeLabel = activeIntent ? studioAgentIntentLabel(activeIntent) : undefined;
  const threadStyle = primary
    ? { flex: collapsed ? "0 0 0" : "1 1 auto", minHeight: collapsed ? 0 : undefined }
    : { height: collapsed ? 0 : panelHeight };

  return (
    <div
      className={[
        "flex min-h-0 flex-col border-line bg-surface",
        primary ? "min-h-0 flex-1 border-t-0" : "shrink-0 border-t"
      ].join(" ")}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5 text-[10px]">
        {!primary ? (
          <button
            type="button"
            className="h-1 w-6 shrink-0 cursor-ns-resize rounded-full bg-line"
            aria-label="调整高度"
            onMouseDown={startResize}
          />
        ) : null}
        <span className="font-medium text-ink">Agent</span>
        {modeLabel ? <span className="text-brand">{modeLabel}</span> : null}
        <span className="text-muted">{voiceProgressLabel(work.featureCore)}</span>
        {phase ? <span className="truncate text-muted">{phase}</span> : null}
        <button
          type="button"
          className="ml-auto text-muted hover:text-ink"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-col overflow-y-auto px-2.5"
        style={threadStyle}
        hidden={collapsed && !primary}
      >
        <StudioAgentTaskPins
          work={work}
          busy={agentBusy || parentBusy}
          canPlan={canPlan}
          canGenerate={isLoggedIn}
          onGeneratePlan={onGeneratePlan}
          onConfirmGenerate={onConfirmGenerate}
        />

        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-1 pb-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={!canChat}
                className="rounded border border-line px-2 py-0.5 text-[10px] text-ink hover:bg-fill disabled:opacity-50"
                onClick={() => void handleSend(p)}
              >
                {p}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-1 pb-1">
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

      <div className="shrink-0 px-2.5 pb-2 pt-1">
        {!isLoggedIn && ready ? (
          <p className="mb-1 text-[10px] text-warning-ink">
            <Link href="/login" className="text-brand underline">
              登录
            </Link>
            后可用
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
          modeLabel={modeLabel}
        />
      </div>
    </div>
  );
}
