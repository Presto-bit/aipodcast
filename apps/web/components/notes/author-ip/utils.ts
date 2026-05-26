import type { AuthorIpDomain, AuthorIpItem, AuthorIpMaterial } from "../../../lib/authorIp";

export type MaterialSegment = "all" | "experience" | "article";

export type TraitRow = {
  dimension?: string;
  label?: string;
  evidence?: string;
  defaultOn?: boolean;
  confidence?: number;
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
  return Array.isArray(tags) ? tags.slice(0, 10) : [];
}

export function vitalityFromItem(item: AuthorIpItem | null) {
  const v = (item?.profile as { vitality?: Record<string, unknown> } | undefined)?.vitality;
  if (!v || typeof v !== "object") return null;
  return v as {
    lastLearnedAt?: string | boolean;
    learnMode?: string;
    tagCloud?: string[];
    topContributors?: string[];
    recentChange?: string;
    materialSummary?: { experienceCount?: number; articleCount?: number; learningCount?: number };
  };
}

export function domainsFromItem(item: AuthorIpItem | null): AuthorIpDomain[] {
  const d = (item?.profile as { domains?: AuthorIpDomain[] } | undefined)?.domains;
  return Array.isArray(d) ? d : [];
}

export const TRAIT_DIMENSION_ORDER = ["立场", "结构", "语气", "修辞", "禁区", "平台", "口吻"] as const;

export function groupTraitsByDimension(traits: TraitRow[]): Record<string, TraitRow[]> {
  const groups: Record<string, TraitRow[]> = {};
  for (const t of traits) {
    const dim = String(t.dimension || "语气").trim() || "语气";
    if (!groups[dim]) groups[dim] = [];
    groups[dim].push(t);
  }
  const ordered: Record<string, TraitRow[]> = {};
  for (const dim of TRAIT_DIMENSION_ORDER) {
    if (groups[dim]?.length) ordered[dim] = groups[dim];
  }
  for (const dim of Object.keys(groups)) {
    if (!ordered[dim]) ordered[dim] = groups[dim];
  }
  return ordered;
}

export function formatLastLearnedAt(raw: string | boolean | undefined): string | null {
  if (!raw) return null;
  if (raw === true) return "刚刚";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 是否有可参与风格学习的素材，用于「更新特色」按钮可用态 */
export function canUpdateAuthorIpStyle(item: AuthorIpItem | null, materials: AuthorIpMaterial[]): boolean {
  if (!item || item.isReadOnly || item.maturity === "empty") return false;
  return materials.some((m) => {
    if (m.includeInStyleLearning === false) return false;
    if (m.materialType !== "experience_card" && m.materialType !== "published" && m.materialType !== "draft") {
      return false;
    }
    const len = m.bodyLength ?? m.body?.length ?? m.preview?.length ?? 0;
    return len > 0;
  });
}

export function maturityDistillHint(
  item: AuthorIpItem | null,
  counts: { experience: number; article: number }
): string {
  if (!item) return "";
  const traitCount = item.traitCount ?? traitsFromItem(item).length;
  const m = String(item.maturity || "empty");
  if (m === "empty") return "先完善定位，并添加至少 1 条经历或成稿";
  if (m === "sketch") {
    if (counts.article < 1) return "再添加 1 篇成稿，可进入「草图+」";
    return "添加素材后点「深度学习」，提炼口吻与结构";
  }
  if (m === "sketch_plus") {
    const need = Math.max(0, 3 - traitCount);
    if (need > 0) return `还差 ${need} 条已开启的特色，可达「已建立」`;
    return "特色接近完备，可用下方预览验证写作场景";
  }
  if (m === "ready") return "风格已建立；素材更新后建议再次深度学习";
  return "建议刷新学习以同步词云与特色";
}
