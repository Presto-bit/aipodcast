/** Studio V2 — 输入框即命令栏（占位符 + ghost） */

import type { WorkStatus } from "./studioWorkTypes";
import type { StudioPlannerTool } from "./studioPlannerContract";
import { studioPlannerGhostLabelZh } from "./studioPlannerContract";

export function studioCommandPlaceholder(params: {
  status: WorkStatus;
  hasPendingPatch: boolean;
  generating: boolean;
  hasError: boolean;
}): string {
  if (params.hasError) return "重试或换一句描述…";
  if (params.generating) return "可继续输入约束，或点 Stop 停止…";
  if (params.hasPendingPatch) return "说怎么改，或在上方勾选后采纳…";
  if (params.status === "ready" || params.status === "shipped") {
    return "选中文字后说怎么改，或直接描述改版…";
  }
  return "描述想写什么，或提问结构、语气、资料…";
}

export function studioCommandGhost(params: {
  routeHint?: string;
  plannerTool?: StudioPlannerTool;
  domainLabel?: string;
}): string {
  if (params.routeHint?.trim()) return params.routeHint.trim();
  if (params.plannerTool) {
    const base = studioPlannerGhostLabelZh(params.plannerTool);
    return params.domainLabel ? `${base} · ${params.domainLabel}` : base;
  }
  return "";
}
