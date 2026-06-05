import type { StudioAgentMode } from "./studioAgentMode";
import type { StudioAgentTool } from "./studioAgentStream";

/** 单 loop 结构化 tool call（与 orchestrator agent_tool_schema 对齐） */
export type StudioAgentToolCall = {
  tool: StudioAgentTool;
  brief?: string;
  reply?: string;
  reason?: string;
};

export type StudioAgentRouteSource = "rules" | "llm" | "mixed";

export type StudioAgentRouteEvent = StudioAgentToolCall & {
  source?: StudioAgentRouteSource;
  mode?: StudioAgentMode;
};

export const STUDIO_AGENT_TOOL_JSON_SHAPE =
  '{"tool":"reply|compose|revise","brief":"compose/revise 任务句","reply":"reply 时≤120字","reason":"可选，10字内"}';

export function parseStudioAgentToolCall(raw: unknown): StudioAgentToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const tool = String(rec.tool || "").trim();
  if (tool !== "reply" && tool !== "compose" && tool !== "revise") return null;
  return {
    tool,
    brief: String(rec.brief || "").trim() || undefined,
    reply: String(rec.reply || "").trim() || undefined,
    reason: String(rec.reason || "").trim() || undefined
  };
}

export function parseStudioAgentRouteEvent(ev: Record<string, unknown>): StudioAgentRouteEvent | null {
  const call = parseStudioAgentToolCall(ev);
  if (!call) return null;
  const source = String(ev.source || "").trim();
  const modeRaw = String(ev.mode || "").trim();
  return {
    ...call,
    source:
      source === "rules" || source === "llm" || source === "mixed"
        ? source
        : undefined,
    mode: modeRaw === "ask" || modeRaw === "write" ? modeRaw : undefined
  };
}

/** SSE route 事件 → UI 提示 */
export function studioAgentRouteHint(
  event: StudioAgentRouteEvent,
  mode: StudioAgentMode = "write"
): string {
  if (mode === "ask" && event.tool !== "reply") {
    return "问答模式：将回复，不会写稿";
  }
  switch (event.tool) {
    case "reply":
      return mode === "ask" ? "问答模式 · 将回复你的问题" : "将回复你的问题";
    case "compose":
      return "写稿模式 · 信息够了，开始写稿…";
    case "revise":
      return "写稿模式 · 将按你的意见改版…";
    default:
      return "";
  }
}
