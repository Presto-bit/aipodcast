/** 笔记本绑定写作风格（v6）：快照与同步状态 */

import type { AuthorIpItem } from "./authorIp";

type TraitRow = { label?: string; defaultOn?: boolean };

function traitsFromItem(item: AuthorIpItem | null): TraitRow[] {
  const traits = (item?.profile as { traits?: TraitRow[] })?.traits;
  return Array.isArray(traits) ? traits : [];
}

function tagCloudFromItem(item: AuthorIpItem | null): string[] {
  const tags = (item?.profile as { vitality?: { tagCloud?: string[] } })?.vitality?.tagCloud;
  return Array.isArray(tags) ? tags.slice(0, 10) : [];
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

export function buildStyleSummaryChips(item: AuthorIpItem | null, max = 5): string[] {
  const tags = tagCloudFromItem(item);
  const traits = traitsFromItem(item)
    .filter((t) => t.defaultOn !== false && t.label)
    .map((t) => String(t.label));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...traits, ...tags]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
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
  const traits = traitsFromItem(item)
    .filter((t) => t.defaultOn !== false && t.label)
    .slice(0, 8);
  if (traits.length) {
    parts.push(`口吻特色：${traits.map((t) => t.label).join("、")}`);
  }
  const tags = tagCloudFromItem(item).slice(0, 6);
  if (tags.length) parts.push(`关键词：${tags.join("、")}`);
  return parts.join("\n");
}
