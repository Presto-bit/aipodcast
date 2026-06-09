/** Studio V2 — Work 卡片信息架构 */

import { studioDomainLabel, studioFormatLabel, type StudioDomain, type StudioFormat } from "./studioDomainProfile";
import type { StudioWork } from "./studioWorkTypes";

export function formatWorkCardMeta(work: StudioWork): string {
  const domain = work.domain ?? "general";
  const format = work.format ?? "general";
  const domainPart =
    domain !== "general" || format !== "general"
      ? `${studioDomainLabel(domain)} · ${studioFormatLabel(format)}`
      : "";
  const timePart = formatRelativeTime(work.updatedAt);
  const statusPart = work.status === "generating" ? "生成中" : work.pendingPatch ? "待确认" : "";
  return [domainPart, statusPart, timePart].filter(Boolean).join(" · ");
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function workCardDomainTag(work: StudioWork): { domain: StudioDomain; format: StudioFormat } {
  return {
    domain: work.domain ?? "general",
    format: work.format ?? "general"
  };
}
