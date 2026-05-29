import type { WorkItem } from "./worksTypes";
import { isTextOnlyWorkType } from "./worksTypes";
import { worksNavPrimaryKind } from "./worksNavMetaLine";

/** 全站「音频」Tab：可播放类成片（含 TTS、短视频） */
export function isAudioGalleryWorkType(type: string | undefined): boolean {
  const t = String(type || "").trim();
  if (isTextOnlyWorkType(t)) return false;
  return (
    t === "podcast_generate" ||
    t === "podcast" ||
    t === "text_to_speech" ||
    t === "tts"
  );
}

export function workGalleryTypeChipLabel(work: Pick<WorkItem, "type" | "workProgramName">): string {
  const program = String(work.workProgramName || "").trim();
  if (program) return program.length > 24 ? `${program.slice(0, 24)}…` : program;
  return worksNavPrimaryKind(work.type);
}

export function scriptExcerptFromWork(work: Pick<WorkItem, "scriptText">, maxChars = 160): string {
  const raw = String(work.scriptText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const chars = Array.from(raw);
  if (chars.length <= maxChars) return raw;
  return chars.slice(0, maxChars).join("") + "…";
}

export function splitWorksByGalleryKind(works: WorkItem[]): { audio: WorkItem[]; script: WorkItem[] } {
  const audio: WorkItem[] = [];
  const script: WorkItem[] = [];
  for (const w of works) {
    if (isTextOnlyWorkType(String(w.type || ""))) script.push(w);
    else if (isAudioGalleryWorkType(String(w.type || ""))) audio.push(w);
    else script.push(w);
  }
  return { audio, script };
}

export function sortWorksByRecency(works: WorkItem[]): WorkItem[] {
  return [...works].sort((a, b) => {
    const ta = new Date(String(a.createdAt || 0)).getTime();
    const tb = new Date(String(b.createdAt || 0)).getTime();
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
}

export type WorksGalleryTab = "audio" | "script" | "active";

const ACTIVE_JOB_STATUSES = new Set(["running", "queued", "processing", "pending"]);

function workIsInFlight(work: WorkItem): boolean {
  const st = String(work.status || "").trim().toLowerCase();
  return ACTIVE_JOB_STATUSES.has(st);
}

/**
 * 知识库/侧栏「查看全部」默认 Tab：优先进行中，否则按最近成片类型，再按数量兜底。
 */
export function inferPreferredWorksGalleryTab(input: {
  works: WorkItem[];
  pendingStudioWork?: WorkItem | null;
}): WorksGalleryTab {
  const pending = input.pendingStudioWork;
  if (pending && workIsInFlight(pending)) {
    return "active";
  }

  const sorted = sortWorksByRecency(input.works);
  const latest = sorted[0];
  if (latest) {
    const t = String(latest.type || "");
    if (isTextOnlyWorkType(t)) return "script";
    if (isAudioGalleryWorkType(t)) return "audio";
  }

  const { audio, script } = splitWorksByGalleryKind(input.works);
  if (script.length > audio.length) return "script";
  if (audio.length > 0) return "audio";
  if (script.length > 0) return "script";
  return "audio";
}

export function buildWorksTabHref(tab: WorksGalleryTab, returnTo?: string): string {
  const q = new URLSearchParams({ tab });
  const rt = String(returnTo || "").trim();
  if (rt) q.set("returnTo", rt);
  return `/works?${q.toString()}`;
}

/** 进行中任务尚无 RSS 发布记录，跳过查询以减少轮询时的重复请求。 */
export function shouldLookupRssPublications(work: Pick<WorkItem, "id" | "status">): boolean {
  const id = String(work.id || "").trim();
  if (!id) return false;
  return !workIsInFlight(work as WorkItem);
}

/** 稳定 job id 键：仅当成片集合变化时才触发 RSS 批量查询。 */
export function rssPublicationJobIdsKey(
  works: ReadonlyArray<Pick<WorkItem, "id" | "status">>
): string {
  const ids: string[] = [];
  for (const w of works) {
    if (!shouldLookupRssPublications(w)) continue;
    ids.push(String(w.id).trim());
  }
  return [...new Set(ids)].sort().join(",");
}

export type WorkDurationHydrationInput = Pick<WorkItem, "id" | "status" | "audioDurationSec"> & {
  isPodcastPublicTemplate?: boolean;
};

/** 已完成且列表未带时长、非模板的作品才需补全 duration。 */
export function shouldHydrateWorkDuration(work: WorkDurationHydrationInput): boolean {
  const id = String(work.id || "").trim();
  if (!id) return false;
  if (workIsInFlight(work as WorkItem)) return false;
  if (work.isPodcastPublicTemplate) return false;
  const sec = work.audioDurationSec;
  if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) return false;
  return true;
}

/** 稳定 job id 键：仅当待补时长成片集合变化时才触发批量/探测请求。 */
export function workDurationHydrationJobIdsKey(
  works: ReadonlyArray<WorkDurationHydrationInput>
): string {
  const ids: string[] = [];
  for (const w of works) {
    if (!shouldHydrateWorkDuration(w)) continue;
    ids.push(String(w.id).trim());
  }
  return [...new Set(ids)].sort().join(",");
}
