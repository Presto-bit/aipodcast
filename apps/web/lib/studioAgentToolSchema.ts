import type { StudioAgentMode } from "./studioAgentMode";
import type { StudioAgentTool } from "./studioAgentStream";
import {
  legacyToolToPlanner,
  parseStudioPlannerDecision,
  studioPlannerRouteGhost,
  type StudioPlannerDecision,
  type StudioPlannerTool
} from "./studioPlannerContract";

/** 单 loop 结构化 tool call（V2 Planner 契约） */
export type StudioAgentToolCall = {
  tool: StudioAgentTool;
  brief?: string;
  reply?: string;
  reason?: string;
  domain?: string;
  format?: string;
  assumptions?: string[];
  reviseScope?: { blocks?: string[]; intent?: string; tier?: string; fullRewrite?: boolean };
};

export type StudioAgentRouteSource = "rules" | "llm" | "mixed";

export type StudioAgentRouteEvent = StudioAgentToolCall & {
  source?: StudioAgentRouteSource;
  mode?: StudioAgentMode;
  plannerTool?: StudioPlannerTool;
};

export const STUDIO_AGENT_TOOL_JSON_SHAPE =
  '{"tool":"read_manuscript|search_corpus|compose|patch|reply|revise","brief":"任务句","reply":"可选草稿（下游扩展）","reason":"必填","domain":"可选","format":"可选","assumptions":[]}';

export function parseStudioAgentToolCall(raw: unknown): StudioAgentToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const toolRaw = String(rec.tool || "").trim();
  const planner = parseStudioPlannerDecision(raw);
  let tool: StudioAgentTool;
  if (toolRaw === "reply" || toolRaw === "compose" || toolRaw === "revise") {
    tool = toolRaw;
  } else if (planner) {
    tool =
      planner.tool === "patch"
        ? "revise"
        : planner.tool === "compose"
          ? "compose"
          : planner.tool === "reply"
            ? "reply"
            : planner.tool === "read_manuscript" || planner.tool === "search_corpus"
              ? "reply"
              : "compose";
  } else {
    return null;
  }
  const assumptionsRaw = rec.assumptions;
  const assumptions = Array.isArray(assumptionsRaw)
    ? assumptionsRaw.map((a) => String(a).trim()).filter(Boolean)
    : undefined;
  return {
    tool,
    brief: String(rec.brief || "").trim() || undefined,
    reply: String(rec.reply || "").trim() || undefined,
    reason: String(rec.reason || "").trim() || undefined,
    domain: rec.domain ? String(rec.domain).trim() : undefined,
    format: rec.format ? String(rec.format).trim() : undefined,
    assumptions,
    reviseScope:
      rec.reviseScope && typeof rec.reviseScope === "object"
        ? (rec.reviseScope as StudioAgentToolCall["reviseScope"])
        : undefined
  };
}

export function parseStudioAgentRouteEvent(ev: Record<string, unknown>): StudioAgentRouteEvent | null {
  const call = parseStudioAgentToolCall(ev);
  if (!call) return null;
  const source = String(ev.source || "").trim();
  const modeRaw = String(ev.mode || "").trim();
  const plannerTool = legacyToolToPlanner(String(ev.tool || call.tool));
  return {
    ...call,
    plannerTool,
    source:
      source === "rules" || source === "llm" || source === "mixed"
        ? source
        : undefined,
    mode: modeRaw === "ask" || modeRaw === "write" ? modeRaw : undefined
  };
}

/** SSE route 事件 → 命令栏 ghost */
export function studioAgentRouteHint(
  event: StudioAgentRouteEvent,
  mode: StudioAgentMode = "write"
): string {
  if (mode === "ask" && event.tool !== "reply") {
    return "Answering… · 问答模式";
  }
  const decision: StudioPlannerDecision = {
    tool: event.plannerTool ?? legacyToolToPlanner(event.tool),
    reason: event.reason ?? "",
    domain: event.domain as StudioPlannerDecision["domain"],
    format: event.format as StudioPlannerDecision["format"]
  };
  return studioPlannerRouteGhost(decision, { zh: true });
}
