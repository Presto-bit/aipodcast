import type { WorkItem } from "../../lib/worksTypes";

export function workIsSharedNotebookForeign(w: Pick<WorkItem, "sharedNotebookForeign">): boolean {
  return w.sharedNotebookForeign === true;
}

/** 全站模板且当前用户非创建者（下载/分享等与模板相关的限制用） */
export function workIsPodcastTemplateNonOwner(
  w: Pick<WorkItem, "isPodcastPublicTemplate" | "jobOwnerUserId">,
  viewerAccountRef: string
): boolean {
  if (!w.isPodcastPublicTemplate) return false;
  const owner = String(w.jobOwnerUserId || "").trim().toLowerCase();
  const viewer = String(viewerAccountRef || "").trim().toLowerCase();
  if (!owner) return true;
  if (!viewer) return true;
  return viewer !== owner;
}

/** 他人笔记本只读，或全站模板且当前用户非创建者：列表区禁止改名/封面/删除等 */
export function workGalleryRowMutationsLocked(
  w: Pick<WorkItem, "sharedNotebookForeign" | "isPodcastPublicTemplate" | "jobOwnerUserId">,
  viewerAccountRef: string
): boolean {
  if (workIsSharedNotebookForeign(w)) return true;
  return workIsPodcastTemplateNonOwner(w, viewerAccountRef);
}
import { worksNavMetricPart, worksNavPrimaryKind } from "../../lib/worksNavMetaLine";

export type PodcastWorkRow = WorkItem & { displayTitle: string };

export function isPodcastManuscriptDraftTarget(jobType: string): boolean {
  const t = String(jobType || "").trim();
  return t === "podcast_generate" || t === "podcast";
}

const NOTE_TITLE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function humanNoteSourceLabel(raw: string): string {
  const s = String(raw || "").trim();
  if (!s || NOTE_TITLE_UUID_RE.test(s)) return "未命名笔记";
  return s;
}

export const NOTES_STUDIO_REF_TITLE_MAX_CHARS = 48;

export function truncateByGraphemes(s: string, maxChars: number): string {
  const t = String(s || "").trim();
  if (maxChars < 1) return "";
  const chars = Array.from(t);
  if (chars.length <= maxChars) return t;
  return chars.slice(0, maxChars).join("") + "…";
}

export function formatUnifiedWorksNavMetaLine(
  w: PodcastWorkRow,
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null,
  createdZh: string,
  authorDisplay: string
): string {
  const primaryK = worksNavPrimaryKind(w.type);
  const metricP = worksNavMetricPart(isScriptDraft, durationLine, scriptCharCountDisplay);
  return [primaryK, authorDisplay, metricP, createdZh]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" | ");
}

export function formatNotesStudioCardSynopsis(
  w: PodcastWorkRow,
  isScriptDraft: boolean,
  durationLine: string,
  scriptCharCountDisplay: number | null,
  createdShort: string
): string {
  const genre = isScriptDraft ? "文章" : "播客";
  const rawTitles = Array.isArray(w.notesSourceTitles) ? w.notesSourceTitles : [];
  const labeled = rawTitles.map((t) => humanNoteSourceLabel(String(t)));
  const firstTitle = labeled.find((t) => t && t !== "未命名笔记") || labeled[0] || "";
  const nTotal =
    typeof w.notesSourceNoteCount === "number" && w.notesSourceNoteCount > 0 ? w.notesSourceNoteCount : rawTitles.length;
  const sourcePart = firstTitle
    ? `《${firstTitle}》`
    : nTotal > 0
      ? `已选 ${nTotal} 条笔记`
      : "来源未记录";
  const metric = isScriptDraft
    ? scriptCharCountDisplay != null && scriptCharCountDisplay > 0
      ? `约 ${Math.round(scriptCharCountDisplay).toLocaleString()} 字`
      : ""
    : durationLine !== "—"
      ? `时长 ${durationLine}`
      : "—";
  const segs = [genre, sourcePart, metric, createdShort].map((s) => String(s || "").trim()).filter(Boolean);
  return segs.join(" · ");
}
