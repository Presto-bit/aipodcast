import { normalizeStreamManuscriptBlocks } from "./studioManuscriptStream";
import type { StudioAgentMode } from "./studioAgentMode";
import {
  parseStudioAgentRouteEvent,
  parseStudioAgentToolCall,
  type StudioAgentRouteEvent,
  type StudioAgentToolCall
} from "./studioAgentToolSchema";
import { parseStudioAgentStep, upsertAgentStep, type StudioAgentStep } from "./studioAgentSteps";
import { plannerAgentTurns } from "./studioPlannerTurns";
import type { StudioExplicitGoal } from "./studioExplicitGoal";
import { normalizeStudioExplicitGoal } from "./studioExplicitGoal";
import type { StudioDomain, StudioFormat } from "./studioDomainProfile";
import type { ManuscriptBlock, PendingPatch, StudioAgentTurn, WorkStatus } from "./studioWorkTypes";

export type StudioAgentTool = "reply" | "compose" | "revise";

export type { StudioAgentToolCall, StudioAgentRouteEvent, StudioAgentStep };

export type StudioAgentStreamInput = {
  message: string;
  agentTurns: StudioAgentTurn[];
  status: WorkStatus;
  versionCount: number;
  taskSentence: string;
  intake: Record<string, string | string[]>;
  notebook: string;
  noteIds: string[];
  featureCore?: Record<string, unknown>;
  authorPrompt?: string;
  stylePrompt?: string;
  agentMode?: StudioAgentMode;
  manuscriptBlocks?: ManuscriptBlock[];
  activeVersionId?: string;
  clientRunId?: string;
  forceCompose?: boolean;
  explicitGoal?: StudioExplicitGoal;
  pendingPatch?: boolean;
  selectionSnippet?: string;
  workBrief?: string;
  domain?: StudioDomain;
  format?: StudioFormat;
  authHeaders: Record<string, string>;
  signal?: AbortSignal;
  onSession?: (requestId: string) => void;
  onToolCall?: (call: StudioAgentToolCall & { mode?: StudioAgentMode; source?: string }) => void;
  onStep?: (step: StudioAgentStep) => void;
  onRoute?: (route: StudioAgentRouteEvent) => void;
  onReply?: (text: string) => void;
  onPhase?: (message: string, tool: StudioAgentTool) => void;
  onBlockDelta?: (blocks: ManuscriptBlock[], tool: StudioAgentTool) => void;
  onBodyDelta?: (body: string, tool: StudioAgentTool) => void;
  onStreamReset?: (tool: StudioAgentTool) => void;
  onPatchProposed?: (patch: PendingPatch, tool: StudioAgentTool) => void;
};

export type StudioAgentStreamResult =
  | { status: "reply"; text: string }
  | { status: "patch"; tool: "compose" | "revise"; pendingPatch: PendingPatch; blocks: ManuscriptBlock[] }
  | { status: "done"; tool: "compose" | "revise"; blocks: ManuscriptBlock[] }
  | { status: "error"; error: string }
  | { status: "aborted" };

export async function streamStudioAgent(
  input: StudioAgentStreamInput
): Promise<StudioAgentStreamResult> {
  const aborted = () => Boolean(input.signal?.aborted);

  let res: Response;
  try {
    res = await fetch("/api/studio/agent/stream", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...input.authHeaders
    },
    body: JSON.stringify({
      message: input.message.trim(),
      agentTurns: plannerAgentTurns(input.agentTurns),
      status: input.status,
      versionCount: input.versionCount,
      taskSentence: input.taskSentence.trim(),
      intake: input.intake,
      notebook: input.notebook.trim(),
      noteIds: input.noteIds,
      featureCore: input.featureCore ?? {},
      authorPrompt: input.authorPrompt?.trim() || "",
      stylePrompt: input.stylePrompt?.trim() || "",
      agentMode: input.agentMode ?? "write",
      domain: input.domain ?? "general",
      format: input.format ?? "general",
      manuscriptBlocks: (input.manuscriptBlocks ?? []).map((b) => ({ ...b })),
      activeVersionId: input.activeVersionId?.trim() || "",
      clientRunId: input.clientRunId?.trim() || "",
      forceCompose: Boolean(input.forceCompose),
      explicitGoal: normalizeStudioExplicitGoal(input.explicitGoal),
      pendingPatch: Boolean(input.pendingPatch),
      selectionSnippet: input.selectionSnippet?.trim() || "",
      workBrief: input.workBrief?.trim() || "",
      useRag: input.noteIds.length > 0,
      sourceType: input.noteIds.length > 0 ? "notes_rag" : "composer_prompt"
    }),
    signal: input.signal
    });
  } catch (err) {
    if (aborted() || isStreamFetchAbortError(err)) {
      return { status: "aborted" };
    }
    const msg = String(err instanceof Error ? err.message : err).trim();
    return { status: "error", error: msg || "Agent 请求失败" };
  }

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = String(data.detail || data.error || data.message || `HTTP ${res.status}`).trim();
    return { status: "error", error: msg || "Agent 请求失败" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let replyText = "";
  let replyNotified = false;
  let doneTool: "compose" | "revise" | null = null;
  let doneBlocks: ManuscriptBlock[] = [];
  let pendingPatch: PendingPatch | null = null;
  let agentSteps: StudioAgentStep[] = [];
  let firstDeltaAt = 0;
  const startedAt = Date.now();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }
          const type = String(ev.type || "");
          const tool = String(ev.tool || "") as StudioAgentTool;

          if (type === "session") {
            const rid = String(ev.requestId || "").trim();
            if (rid) input.onSession?.(rid);
          } else if (type === "step") {
            const step = parseStudioAgentStep(ev);
            if (step) {
              agentSteps = upsertAgentStep(agentSteps, step);
              input.onStep?.(step);
            }
          } else if (type === "tool_call") {
            const call = parseStudioAgentToolCall(ev);
            if (call) {
              const modeRaw = String(ev.mode || "").trim();
              input.onToolCall?.({
                ...call,
                mode: modeRaw === "ask" || modeRaw === "write" ? modeRaw : input.agentMode,
                source: String(ev.source || "").trim() || undefined
              });
            }
          } else if (type === "route") {
            const route = parseStudioAgentRouteEvent(ev);
            if (route) input.onRoute?.(route);
          } else if (type === "reply") {
            replyText = String(ev.text || "").trim();
            if (replyText && !replyNotified) {
              replyNotified = true;
              input.onReply?.(replyText);
            }
          } else if (type === "phase") {
            const msg = String(ev.message || "").trim();
            if (msg) input.onPhase?.(msg, tool === "revise" ? "revise" : "compose");
          } else if (type === "body_delta") {
            if (!firstDeltaAt) firstDeltaAt = Date.now();
            const body = String(ev.body || "");
            if (body) input.onBodyDelta?.(body, tool === "revise" ? "revise" : "compose");
          } else if (type === "stream_reset") {
            input.onStreamReset?.(tool === "revise" ? "revise" : "compose");
          } else if (type === "block_delta") {
            if (!firstDeltaAt) firstDeltaAt = Date.now();
            const blocks = normalizeStreamManuscriptBlocks(ev.blocks);
            if (blocks.length) {
              input.onBlockDelta?.(blocks, tool === "revise" ? "revise" : "compose");
            }
          } else if (type === "patch_proposed") {
            const raw = ev.pendingPatch;
            if (raw && typeof raw === "object") {
              const p = raw as Record<string, unknown>;
              pendingPatch = {
                fromVersionId: String(p.fromVersionId || ""),
                proposedBlocks: normalizeStreamManuscriptBlocks(p.proposedBlocks),
                summary: String(p.summary || "改版提议"),
                reason: String(p.reason || "").trim() || undefined,
                qualityNote: String(p.qualityNote || "").trim() || undefined,
                changedKeys: Array.isArray(p.changedKeys)
                  ? p.changedKeys.map((k) => String(k))
                  : undefined,
                selections: Array.isArray(p.selections)
                  ? p.selections.map((k) => String(k))
                  : undefined,
                sourceRunId: String(p.sourceRunId || "").trim() || undefined
              };
              input.onPatchProposed?.(
                pendingPatch,
                tool === "revise" ? "revise" : "compose"
              );
            }
          } else if (type === "done") {
            const dt = String(ev.tool || "");
            if (dt === "reply") {
              const text = (replyText || "好的。").trim();
              if (text && !replyNotified) {
                replyNotified = true;
                input.onReply?.(text);
              }
              return { status: "reply", text };
            }
            doneTool = dt === "revise" ? "revise" : "compose";
            doneBlocks = normalizeStreamManuscriptBlocks(ev.blocks);
          } else if (type === "error") {
            return { status: "error", error: String(ev.message || "生成失败") };
          }
        }
      }
    }
  } catch (err) {
    if (aborted() || isStreamFetchAbortError(err)) {
      return { status: "aborted" };
    }
    const msg = String(err instanceof Error ? err.message : err).trim();
    return { status: "error", error: msg || "Agent 流中断" };
  }

  if (aborted()) {
    return { status: "aborted" };
  }

  if (replyText && !doneTool) {
    return { status: "reply", text: replyText };
  }

  if (doneTool && (doneBlocks.length || pendingPatch)) {
    if (!firstDeltaAt && !pendingPatch && Date.now() - startedAt > 8000) {
      return { status: "error", error: "生成超时：8 秒内未收到稿件更新" };
    }
    if (pendingPatch) {
      return {
        status: "patch",
        tool: doneTool,
        pendingPatch,
        blocks: doneBlocks.length ? doneBlocks : pendingPatch.proposedBlocks
      };
    }
    return { status: "done", tool: doneTool, blocks: doneBlocks };
  }

  return { status: "error", error: "Agent 未返回完整结果" };
}

/** fetch/SSE 被 AbortController 取消时浏览器常报 Network error / Failed to fetch */
export function isStreamFetchAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  const msg = err.message.trim().toLowerCase();
  return msg.includes("aborted") || msg.includes("user aborted");
}
