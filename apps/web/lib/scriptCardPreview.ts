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

export function scriptCoverGradientClass(seed: string): string {
  const s = String(seed || "").trim();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

export function scriptCoverInitials(title: string): string {
  const t = String(title || "").trim();
  if (!t) return "文";
  const chars = Array.from(t.replace(/\s+/g, ""));
  if (/^[\u4e00-\u9fff]/.test(chars[0] || "")) {
    return chars.slice(0, 2).join("") || "文";
  }
  const word = t.split(/\s+/).find(Boolean) || t;
  return word.slice(0, 2).toUpperCase() || "A";
}

export function scriptGenreChip(jobType: string | undefined): {
  label: string;
  tone: "article" | "social";
} {
  const t = String(jobType || "").trim();
  if (t === "social_publish_draft") return { label: "自媒体", tone: "social" };
  return { label: "文章", tone: "article" };
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
