import type { WorkItem } from "./worksTypes";
import { humanNoteSourceLabel, truncateByGraphemes } from "../components/podcast/workGalleryListShared";

const COVER_GRADIENTS = [
  "bg-gradient-to-br from-brand/35 via-brand/15 to-fill",
  "bg-gradient-to-br from-violet-500/30 via-brand/12 to-fill",
  "bg-gradient-to-br from-sky-500/28 via-fill to-brand/10",
  "bg-gradient-to-br from-emerald-500/25 via-fill to-brand/14",
  "bg-gradient-to-br from-amber-500/22 via-fill to-cta/12",
  "bg-gradient-to-br from-rose-500/24 via-fill to-brand/10",
  "bg-gradient-to-br from-indigo-500/28 via-brand/10 to-fill",
  "bg-gradient-to-br from-teal-500/26 via-fill to-brand/12"
] as const;

const SOCIAL_COVER_GRADIENTS = [
  "bg-gradient-to-br from-orange-500/35 via-cta/20 to-fill",
  "bg-gradient-to-br from-rose-500/30 via-orange-400/15 to-fill",
  "bg-gradient-to-br from-amber-500/28 via-cta/12 to-fill"
] as const;

export function scriptCoverGradientClass(seed: string, jobType?: string): string {
  const s = String(seed || "").trim();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  if (String(jobType || "") === "social_publish_draft") {
    return SOCIAL_COVER_GRADIENTS[h % SOCIAL_COVER_GRADIENTS.length];
  }
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

export function scriptGenreChip(jobType: string | undefined): {
  label: string;
  tone: "article" | "social";
} {
  const t = String(jobType || "").trim();
  if (t === "social_publish_draft") return { label: "自媒体", tone: "social" };
  return { label: "文章", tone: "article" };
}

/** 卡片元信息行用的体裁名（小红书、博客长文等） */
export function scriptWorkGenreLabel(work: Pick<WorkItem, "workProgramName" | "type">): string {
  const program = String(work.workProgramName || "").trim();
  if (program) {
    const parts = program.split("·").map((s) => s.trim()).filter(Boolean);
    const tail = parts.length > 1 ? parts[parts.length - 1]! : program;
    return tail.length > 20 ? `${tail.slice(0, 20)}…` : tail;
  }
  return "";
}

export function scriptCardMetaLine(
  work: Pick<WorkItem, "workProgramName" | "type">,
  createdFormatted: string
): string {
  const genre = scriptWorkGenreLabel(work);
  const parts = [
    createdFormatted && createdFormatted !== "—" ? createdFormatted : "",
    genre
  ].filter(Boolean);
  return parts.join(" · ");
}

export function scriptCoverInitials(title: string, genreLabel?: string, jobType?: string): string {
  const t = String(title || "").trim();
  const meaningful = Array.from(t.replace(/\s+/g, "")).filter((c) =>
    /[\u4e00-\u9fffA-Za-z0-9]/.test(c)
  );
  if (meaningful.length > 0) {
    if (/^[\u4e00-\u9fff]/.test(meaningful[0]!)) {
      return meaningful.slice(0, 2).join("") || "文";
    }
    const word = t.split(/\s+/).find((w) => /[A-Za-z0-9]/.test(w)) || t;
    const letters = word.replace(/[^A-Za-z0-9]/g, "");
    if (letters.length > 0) return letters.slice(0, 2).toUpperCase();
  }
  const genre = String(genreLabel || "").trim();
  if (genre) {
    const g = Array.from(genre).filter((c) => /[\u4e00-\u9fff]/.test(c));
    if (g.length >= 2) return g.slice(0, 2).join("");
    if (g.length === 1) return g[0]!;
  }
  if (String(jobType || "") === "social_publish_draft") return "自媒";
  return "文";
}

export function cleanScriptPreviewText(raw: string): string {
  return String(raw || "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*\[(?:S\d+|主持人|嘉宾)[^\]]*\]\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function scriptCardPreviewFromWork(
  work: Pick<WorkItem, "scriptText">,
  maxChars: number
): string {
  const cleaned = cleanScriptPreviewText(String(work.scriptText || ""));
  if (!cleaned) return "";
  return truncateByGraphemes(cleaned, maxChars);
}

export function scriptCharCountForWork(
  work: Pick<WorkItem, "scriptCharCount" | "scriptText">
): number | null {
  const declared = work.scriptCharCount;
  if (typeof declared === "number" && Number.isFinite(declared) && declared > 0) {
    return Math.round(declared);
  }
  const fromText = cleanScriptPreviewText(String(work.scriptText || "")).length;
  return fromText > 0 ? fromText : null;
}

export function formatScriptCharCountLabel(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count) || count <= 0) return "";
  return `约 ${Math.round(count).toLocaleString()} 字`;
}

export function scriptSourceNoteLine(
  work: Pick<WorkItem, "notesSourceTitles" | "notesSourceNoteCount" | "notesSourceNotebook">
): { text: string; notebookHref: string | null; title: string } | null {
  const rawTitles = Array.isArray(work.notesSourceTitles) ? work.notesSourceTitles : [];
  const labeled = rawTitles.map((t) => humanNoteSourceLabel(String(t)));
  const firstTitle = labeled.find((t) => t && t !== "未命名笔记") || labeled[0] || "";
  const nTotal =
    typeof work.notesSourceNoteCount === "number" && work.notesSourceNoteCount > 0
      ? work.notesSourceNoteCount
      : rawTitles.length;
  if (!firstTitle && nTotal < 1) return null;
  const nb = String(work.notesSourceNotebook || "").trim();
  const notebookHref = nb ? `/notes?notebook=${encodeURIComponent(nb)}` : null;
  const text = firstTitle
    ? nTotal > 1
      ? `《${firstTitle}》等 ${nTotal} 条笔记`
      : `《${firstTitle}》`
    : `已选 ${nTotal} 条笔记`;
  return { text, notebookHref, title: text };
}

export function buildNotesNotebookHref(notebookName: string | undefined): string | null {
  const nb = String(notebookName || "").trim();
  if (!nb) return null;
  return `/notes?notebook=${encodeURIComponent(nb)}`;
}
