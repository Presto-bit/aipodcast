/** 笔记本绑定写作风格（v6）：快照与同步状态 */

import type { AuthorIpItem } from "./authorIp";
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

/** 与后端 TRAIT_DIMENSIONS 一致 */
export const STYLE_TRAIT_DIMENSIONS = ["立场", "结构", "语气", "修辞", "禁区", "平台"] as const;

export type StyleTraitRow = {
  dimension?: string;
  label?: string;
  defaultOn?: boolean;
  evidence?: string;
};

type TraitRow = StyleTraitRow;

function normalizeTraitDimension(dim: string | undefined): string {
  const d = (dim || "语气").trim() || "语气";
  return d === "口吻" ? "语气" : d;
}

function traitsFromItemFull(item: AuthorIpItem | null): StyleTraitRow[] {
  const traits = (item?.profile as { traits?: StyleTraitRow[] })?.traits;
  return Array.isArray(traits) ? traits : [];
}

function traitsFromItem(item: AuthorIpItem | null): TraitRow[] {
  return traitsFromItemFull(item);
}

/** 按 dimension 分组，同分类排在一起 */
export function groupStyleTraitsByDimension(
  traits: StyleTraitRow[]
): Array<{ dimension: string; items: StyleTraitRow[] }> {
  const active = traits.filter((t) => t.defaultOn !== false && String(t.label || "").trim());
  const buckets = new Map<string, StyleTraitRow[]>();
  for (const t of active) {
    const dim = normalizeTraitDimension(t.dimension);
    const list = buckets.get(dim) || [];
    list.push(t);
    buckets.set(dim, list);
  }
  const out: Array<{ dimension: string; items: StyleTraitRow[] }> = [];
  for (const dim of STYLE_TRAIT_DIMENSIONS) {
    const items = buckets.get(dim);
    if (items?.length) out.push({ dimension: dim, items });
    buckets.delete(dim);
  }
  for (const [dimension, items] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))) {
    if (items.length) out.push({ dimension, items });
  }
  return out;
}

function tagCloudFromItem(item: AuthorIpItem | null): string[] {
  const tags = (item?.profile as { vitality?: { tagCloud?: string[] } })?.vitality?.tagCloud;
  return Array.isArray(tags) ? tags.slice(0, 12) : [];
}

function formatLastLearnedAt(raw: string | boolean | undefined): string | null {
  if (!raw) return null;
  if (raw === true) return "刚刚";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export type StyleSyncStatus = "none" | "ready" | "outdated";

export type StyleSnapshot = {
  noteIds?: string[];
  noteVersions?: Record<string, string>;
  learnedAt?: string;
};

export type NoteStyleMeta = {
  noteId: string;
  contentVersion?: string;
  noteRagBodyHash?: string;
  updatedAt?: string;
  bodyLength?: number;
  ragChunkCount?: number;
  /** P2：RAG 索引后已缓存 per-note 风格特征，learn 可走 features_merge */
  styleFeaturesReady?: boolean;
};

/** 勾选资料是否均已具备与正文指纹一致的风格特征 */
export function selectedNotesStyleFeaturesReady(
  noteMetas: NoteStyleMeta[],
  selectedNoteIds: string[]
): boolean {
  const selected = new Set(selectedNoteIds);
  const picked = noteMetas.filter((m) => selected.has(m.noteId));
  if (!picked.length) return false;
  return picked.every((m) => Boolean(m.styleFeaturesReady));
}

export function styleSnapshotFromItem(item: AuthorIpItem | null): StyleSnapshot | null {
  const snap = (item?.profile as { styleSnapshot?: StyleSnapshot })?.styleSnapshot;
  return snap && typeof snap === "object" ? snap : null;
}

export function styleSyncStatusFromProfile(item: AuthorIpItem | null): StyleSyncStatus {
  const prof = item?.profile as { styleSyncStatus?: string; styleSnapshot?: StyleSnapshot } | undefined;
  const stored = prof?.styleSyncStatus;
  if (stored === "ready" || stored === "outdated" || stored === "none") return stored;
  return styleSnapshotFromItem(item) ? "ready" : "none";
}

/** 对比当前勾选与快照，计算是否待更新 */
export function computeStyleSyncStatus(
  item: AuthorIpItem | null,
  selectedNoteIds: string[],
  noteMetas: NoteStyleMeta[]
): StyleSyncStatus {
  const snap = styleSnapshotFromItem(item);
  if (!snap?.noteIds?.length) return "none";

  const selected = [...selectedNoteIds].sort();
  const snapIds = [...(snap.noteIds || [])].sort();
  if (selected.length !== snapIds.length || selected.some((id, i) => id !== snapIds[i])) {
    return "outdated";
  }

  const versions = snap.noteVersions || {};
  for (const meta of noteMetas) {
    if (!selectedNoteIds.includes(meta.noteId)) continue;
    const current =
      meta.noteRagBodyHash?.trim() || meta.contentVersion?.trim() || meta.updatedAt?.trim() || "";
    const prev = versions[meta.noteId] || "";
    if (current && prev && current !== prev) return "outdated";
  }
  return "ready";
}

export function buildStyleSummaryText(item: AuthorIpItem | null): string {
  if (!item) return "";
  const one = (item.oneLiner || "").trim();
  if (one) return one;
  const traits = traitsFromItem(item).filter((t) => t.defaultOn !== false && t.label);
  if (traits.length >= 1) {
    return traits
      .slice(0, 3)
      .map((t) => t.label)
      .filter(Boolean)
      .join("、");
  }
  return "勾选资料后提炼你的写作口吻与特色";
}

export function buildStyleSummaryChips(item: AuthorIpItem | null, max = 8): string[] {
  const tags = tagCloudFromItem(item);
  const grouped = groupStyleTraitsByDimension(traitsFromItemFull(item));
  const traitLabels: string[] = [];
  let gi = 0;
  while (traitLabels.length < max && grouped.some((g) => gi < g.items.length)) {
    for (const g of grouped) {
      const label = String(g.items[gi]?.label || "").trim();
      if (label) traitLabels.push(label);
      if (traitLabels.length >= max) break;
    }
    gi += 1;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...traitLabels, ...tags]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** 是否在最近一次成功 learn 的快照内（已就绪时展示「已纳入风格」） */
export function isNoteInStyleSnapshot(noteId: string, item: AuthorIpItem | null): boolean {
  if (styleSyncStatusFromProfile(item) !== "ready") return false;
  const snap = styleSnapshotFromItem(item);
  const ids = snap?.noteIds;
  return Array.isArray(ids) && ids.includes(noteId);
}

export const NOTEBOOK_STYLE_HINT_STORAGE_KEY = "presto_notebook_style_hint_v1";

export function shouldShowNotebookStyleHint(): boolean {
  try {
    return !readLocalStorageScoped(NOTEBOOK_STYLE_HINT_STORAGE_KEY);
  } catch {
    return true;
  }
}

export function dismissNotebookStyleHint(): void {
  writeLocalStorageScoped(NOTEBOOK_STYLE_HINT_STORAGE_KEY, "1");
}

export function notebookAutoSelectStorageKey(notebookName: string): string {
  return `presto_nb_auto_sel:${notebookName.trim()}`;
}

export function formatStyleLearnedAt(item: AuthorIpItem | null): string | null {
  const snap = styleSnapshotFromItem(item);
  if (snap?.learnedAt) {
    return formatLastLearnedAt(snap.learnedAt) || null;
  }
  const v = (item?.profile as { vitality?: { lastLearnedAt?: string } })?.vitality;
  return formatLastLearnedAt(v?.lastLearnedAt);
}

/** 注入生成文章 / 播客的人设与风格提示 */
export function buildNotebookStylePromptBlock(item: AuthorIpItem | null): string {
  if (!item) return "";
  const parts: string[] = [];
  const one = (item.oneLiner || "").trim();
  if (one) parts.push(`写作定位：${one}`);
  const grouped = groupStyleTraitsByDimension(traitsFromItemFull(item)).slice(0, 6);
  if (grouped.length) {
    const lines = grouped.map((g) => {
      const labels = g.items
        .map((t) => String(t.label || "").trim())
        .filter(Boolean)
        .slice(0, 4);
      return labels.length ? `【${g.dimension}】${labels.join("；")}` : "";
    });
    parts.push(`各维度风格：\n${lines.filter(Boolean).join("\n")}`);
  }
  const tags = tagCloudFromItem(item).slice(0, 8);
  if (tags.length) parts.push(`关键词：${tags.join("、")}`);
  return parts.join("\n");
}
