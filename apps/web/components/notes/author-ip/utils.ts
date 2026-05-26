import type { AuthorIpItem } from "../../../lib/authorIp";

export type MaterialSegment = "all" | "experience" | "article";

export type TraitRow = {
  dimension?: string;
  label?: string;
  evidence?: string;
  defaultOn?: boolean;
};

export function maturityLabel(m: string): string {
  const map: Record<string, string> = {
    empty: "待完善",
    sketch: "草图",
    sketch_plus: "草图+",
    ready: "已建立",
    stale: "待学习"
  };
  return map[m] || m;
}

export function countMaterialsByType(materials: { materialType: string }[]) {
  let experience = 0;
  let article = 0;
  let draft = 0;
  for (const m of materials) {
    if (m.materialType === "experience_card") experience += 1;
    else if (m.materialType === "published") article += 1;
    else if (m.materialType === "draft") draft += 1;
  }
  return { experience, article, draft, total: experience + article + draft };
}

export function filterMaterials<T extends { materialType: string }>(materials: T[], segment: MaterialSegment): T[] {
  if (segment === "experience") return materials.filter((m) => m.materialType === "experience_card");
  if (segment === "article") return materials.filter((m) => (m.materialType === "published" || m.materialType === "draft"));
  return materials;
}

export function positioningProgress(item: AuthorIpItem | null): {
  percent: number;
  whoDone: boolean;
  audienceDone: boolean;
  oneLinerDone: boolean;
} {
  if (!item) return { percent: 0, whoDone: false, audienceDone: false, oneLinerDone: false };
  const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string; oneLiner?: string; completedAt?: boolean } };
  const cs = prof.coldStart;
  const oneLinerDone = Boolean((item.oneLiner || cs?.oneLiner || "").trim());
  const whoDone = Boolean((cs?.whoAmI || "").trim());
  const audienceDone = Boolean((cs?.audience || "").trim());
  let n = 0;
  if (oneLinerDone) n += 34;
  if (whoDone) n += 33;
  if (audienceDone) n += 33;
  if (item.maturity !== "empty" && oneLinerDone && n < 100) n = Math.max(n, 67);
  return { percent: Math.min(100, n), whoDone, audienceDone, oneLinerDone };
}

export function triangleState(
  item: AuthorIpItem | null,
  counts: { experience: number; article: number }
): {
  positioning: boolean;
  experience: boolean;
  article: boolean;
  traitsReady: boolean;
} {
  const pos = item ? item.maturity !== "empty" && positioningProgress(item).oneLinerDone : false;
  const traits = item?.traitCount ?? 0;
  return {
    positioning: pos,
    experience: counts.experience >= 1,
    article: counts.article >= 1,
    traitsReady: traits >= 2
  };
}

export function traitsFromItem(item: AuthorIpItem | null): TraitRow[] {
  const prof = item?.profile as { traits?: TraitRow[] } | undefined;
  return Array.isArray(prof?.traits) ? prof.traits : [];
}

export function tagCloudFromItem(item: AuthorIpItem | null): string[] {
  const prof = item?.profile as { vitality?: { tagCloud?: string[] } } | undefined;
  const tags = prof?.vitality?.tagCloud;
  return Array.isArray(tags) ? tags.slice(0, 8) : [];
}
