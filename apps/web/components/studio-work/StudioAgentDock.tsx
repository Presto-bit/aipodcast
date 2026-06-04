"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildStudioAgentQuestion,
  hasTaskContext,
  inferStudioAgentIntent,
  studioTurnsToMemoryTurns
} from "../../lib/studioAgentAsk";
import { featureCoreToPrompt } from "../../lib/homeComposerFeatureCore";
import { getComposerPrefsFeatureCore } from "../../lib/studioWorkStorage";
import { syncWorkTitleFromTurns } from "../../lib/studioWorkTask";
import { markOpenComposerFeature } from "../../lib/studioComposerFeatureLink";
import { WORKBENCH_CHAT_PATH } from "../../lib/navPaths";
import { streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import type { ManuscriptVersion, StudioAgentTurn, StudioWork, WorkStatus } from "../../lib/studioWorkTypes";
import StudioAgentComposer from "./StudioAgentComposer";
import StudioAgentMessage from "./StudioAgentMessage";
import StudioAgentOutputCards from "./StudioAgentOutputCards";
import StudioCorpusBar from "./StudioCorpusBar";

const QUICK_PROMPTS = [
  "我想写一篇清单体内容，受众是产品新人",
  "帮我理清这篇要写什么、结构怎么搭",
  "开头钩子怎么写更抓人"
] as const;

const CONFIRM_TASK_RE =
  /^(确认任务|确认|就按这个|就这样|可以了|开始生成|生成计划)/;

function agentPlaceholder(status: WorkStatus): string {
  if (status === "generating") return "生成中…";
  if (status === "ready" || status === "shipped") return "问运营、解读稿件，或描述改版…";
  if (status === "planned") return "可继续补充说明，或点下方「确认执行」…";
  return "描述你想创作的内容与目标…";
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
  activeVersion,
  reviseText,
  onReviseTextChange,
  onRevise,
  onApplyPatch,
  onDiscardPatch,
  selectedPatchKeys,
  changedKeys,
  onTogglePatchKey,
  onMarkShipped,
  showFeatureNudge,
  onDismissFeatureNudge
}: {
  work: StudioWork;
  isLoggedIn: boolean;
  ready: boolean;
  parentBusy: boolean;
  getAuthHeaders: () => Record<string, string>;
  onPersist: (next: StudioWork) => void;
  onGeneratePlan?: () => void | Promise<void>;
  onConfirmGenerate?: () => void | Promise<void>;
  activeVersion: ManuscriptVersion | null;
  reviseText: string;
  onReviseTextChange: (v: string) => void;
  onRevise?: () => void;
  onApplyPatch?: (partial: boolean) => void;
  onDiscardPatch?: () => void;
  selectedPatchKeys: Set<string>;
  changedKeys: Set<string>;
  onTogglePatchKey: (key: string) => void;
  onMarkShipped?: () => void;
  showFeatureNudge: boolean;
  onDismissFeatureNudge: () => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const turns = work.agentTurns ?? [];
  const readOnly = work.status === "generating" || parentBusy;
  const canChat = isLoggedIn && ready && !readOnly;
  const canPlan = hasTaskContext(work, turns);
  const showQuickPrompts = turns.length === 0 && work.status === "briefing";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [
    turns.length,
    turns[turns.length - 1]?.content,
    work.plan,
    work.status,
    work.runPhase,
    work.pendingPatch,
    activeVersion?.id,
    activeVersion?.blocks.length
  ]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function applyDialogExtract(
    nextTurns: StudioAgentTurn[],
    sessionState: typeof work.agentSessionState = work.agentSessionState ?? null
  ) {
    let next: StudioWork = {
      ...work,
      agentTurns: nextTurns,
      agentSessionState: sessionState ?? null,
      allowModelFallback: true
    };
    onPersist(syncWorkTitleFromTurns(next, nextTurns));
  }

  function patchTurnsStreaming(nextTurns: StudioAgentTurn[]) {
    onPersist({ ...work, agentTurns: nextTurns });
  }

  async function handleSend(overrideText?: string) {
    const q = (overrideText ?? input).trim();
    if (!q || !canChat || agentBusy) return;

    const intent = inferStudioAgentIntent(q, work);

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
        authorIpPrompt: featureCoreToPrompt(getComposerPrefsFeatureCore()),
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
      if (
        onGeneratePlan &&
        !work.plan &&
        work.status === "briefing" &&
        CONFIRM_TASK_RE.test(q) &&
        canPlan
      ) {
        void onGeneratePlan();
      }
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div ref={scrollRef} className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto px-3 py-3">
        {turns.length > 0 ? (
          <div className="space-y-3">
            {turns.map((turn) => (
              <StudioAgentMessage
                key={turn.id}
                turn={turn}
                streamingPhase={turn.streaming ? phase : undefined}
              />
            ))}
          </div>
        ) : null}

        <StudioAgentOutputCards
          work={work}
          busy={agentBusy || parentBusy}
          isLoggedIn={isLoggedIn}
          activeVersion={activeVersion}
          reviseText={reviseText}
          onReviseTextChange={onReviseTextChange}
          onConfirmGenerate={onConfirmGenerate}
          onRevise={onRevise}
          onApplyPatch={onApplyPatch}
          onDiscardPatch={onDiscardPatch}
          selectedPatchKeys={selectedPatchKeys}
          changedKeys={changedKeys}
          onTogglePatchKey={onTogglePatchKey}
          onMarkShipped={onMarkShipped}
          showFeatureNudge={showFeatureNudge}
          onFillFeature={() => {
            markOpenComposerFeature();
            router.push(WORKBENCH_CHAT_PATH);
          }}
          onDismissFeatureNudge={onDismissFeatureNudge}
        />
      </div>

      <div className="shrink-0 border-t border-line bg-surface px-3 pb-3 pt-2">
        <div className="mx-auto w-full max-w-3xl">
          {!isLoggedIn && ready ? (
            <p className="mb-2 text-xs text-warning-ink">
              <Link href="/login" className="text-brand underline">
                登录
              </Link>
              后可用
            </p>
          ) : null}
          {showQuickPrompts ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!canChat}
                  className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-fill disabled:opacity-50"
                  onClick={() => void handleSend(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
          <StudioAgentComposer
            value={input}
            onChange={setInput}
            onSend={() => void handleSend()}
            busy={agentBusy}
            disabled={!canChat}
            placeholder={agentPlaceholder(work.status)}
          />
          <StudioCorpusBar
            work={work}
            isLoggedIn={isLoggedIn}
            ready={ready}
            getAuthHeaders={getAuthHeaders}
            onPersist={onPersist}
          />
        </div>
      </div>
    </div>
  );
}
