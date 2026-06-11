/** Studio V2 — Planner 固定输出契约（前后端对齐） */

import type { StudioDomain, StudioFormat } from "./studioDomainProfile";

export type StudioPlannerTool =
  | "read_manuscript"
  | "search_corpus"
  | "compose"
  | "patch"
  | "reply";

/** 向后兼容：patch 映射 revise */
export type StudioAgentToolLegacy = "reply" | "compose" | "revise";

export type StudioPlannerDecision = {
  tool: StudioPlannerTool;
  brief?: string;
  reply?: string;
  reason: string;
  domain?: StudioDomain;
  format?: StudioFormat;
  assumptions?: string[];
};

export const STUDIO_PLANNER_JSON_SHAPE =
  '{"tool":"read_manuscript|search_corpus|compose|patch|reply","brief":"任务句","reply":"可选草稿（下游扩展）","reason":"必填","domain":"可选","format":"可选","assumptions":["可选假设"]}';

export function normalizePlannerTool(raw: string): StudioPlannerTool | null {
  const t = raw.trim().toLowerCase();
  if (t === "revise") return "patch";
  if (
    t === "read_manuscript" ||
    t === "search_corpus" ||
    t === "compose" ||
    t === "patch" ||
    t === "reply"
  ) {
    return t;
  }
  return null;
}

export function parseStudioPlannerDecision(raw: unknown): StudioPlannerDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const toolRaw = String(rec.tool || "").trim();
  const tool = normalizePlannerTool(toolRaw);
  if (!tool) return null;
  const reason = String(rec.reason || "").trim();
  const assumptionsRaw = rec.assumptions;
  const assumptions = Array.isArray(assumptionsRaw)
    ? assumptionsRaw.map((a) => String(a).trim()).filter(Boolean).slice(0, 5)
    : undefined;
  return {
    tool,
    brief: String(rec.brief || "").trim() || undefined,
    reply: String(rec.reply || "").trim() || undefined,
    reason: reason || studioPlannerGhostLabel(tool),
    domain: rec.domain ? (String(rec.domain).trim() as StudioDomain) : undefined,
    format: rec.format ? (String(rec.format).trim() as StudioFormat) : undefined,
    assumptions
  };
}

/** Ghost 文案（命令栏 Editing… 系） */
export function studioPlannerGhostLabel(tool: StudioPlannerTool): string {
  switch (tool) {
    case "read_manuscript":
      return "Reading…";
    case "search_corpus":
      return "Searching notes…";
    case "compose":
      return "Writing…";
    case "patch":
      return "Editing…";
    case "reply":
      return "Answering…";
    default:
      return "Working…";
  }
}

export function studioPlannerGhostLabelZh(tool: StudioPlannerTool): string {
  switch (tool) {
    case "read_manuscript":
      return "读取稿件…";
    case "search_corpus":
      return "搜索资料…";
    case "compose":
      return "写稿中…";
    case "patch":
      return "编辑中…";
    case "reply":
      return "回答中…";
    default:
      return "处理中…";
  }
}

/** SSE route 事件 → 命令栏 ghost（含 domain） */
export function studioPlannerRouteGhost(
  decision: Pick<StudioPlannerDecision, "tool" | "domain" | "format">,
  opts?: { zh?: boolean }
): string {
  const label = opts?.zh ? studioPlannerGhostLabelZh(decision.tool) : studioPlannerGhostLabel(decision.tool);
  const domainPart =
    decision.domain && decision.domain !== "general"
      ? ` · ${decision.domain}${decision.format ? `/${decision.format}` : ""}`
      : "";
  return `${label}${domainPart}`;
}

/** legacy SSE tool → planner tool */
export function legacyToolToPlanner(tool: string): StudioPlannerTool {
  const n = normalizePlannerTool(tool);
  return n ?? "reply";
}
