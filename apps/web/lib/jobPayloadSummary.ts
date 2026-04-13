import type { JobRecord } from "./types";

/**
 * 从进行中任务的 payload 提炼标题与说明，供「我的作品」摘要区展示。
 */
export function summarizeActiveJobPayload(job: JobRecord): { headline: string; detail: string } {
  const p = job.payload || {};
  if (String(job.job_type || "") === "podcast_short_video") {
    const sid = String(p.source_job_id || "").trim();
    const headline = sid ? `短视频导出（源 ${sid.slice(0, 8)}…）` : "短视频导出";
    return { headline, detail: "合成 9:16 视频、波形与字幕，完成后可在作品页下载 MP4。" };
  }
  const title = String(p.title || p.topic || "").trim();
  const text = String(p.text || "").trim().replace(/\s+/g, " ");
  const url = String(p.url || "").trim();
  const rawNotes = p.selected_note_ids;
  const noteCount = Array.isArray(rawNotes) ? rawNotes.filter((x) => typeof x === "string" && String(x).trim()).length : 0;

  let headline = title;
  if (!headline && text) headline = text.length > 72 ? `${text.slice(0, 72)}…` : text;
  if (!headline && url) headline = url.length > 80 ? `${url.slice(0, 80)}…` : url;
  if (!headline) headline = String(job.job_type || "").trim() || "创作任务";

  const chunks: string[] = [];
  if (title && text && !text.startsWith(title)) {
    chunks.push(text.length > 140 ? `${text.slice(0, 140)}…` : text);
  } else if (!title && text.length > 72) {
    chunks.push(text.length > 200 ? `${text.slice(0, 200)}…` : text);
  }
  if (noteCount > 0) chunks.push(`已选 ${noteCount} 条笔记`);
  if (url && headline !== url && !chunks.some((c) => c.includes(url)))
    chunks.push(url.length > 96 ? `${url.slice(0, 96)}…` : url);

  const detail = chunks.filter(Boolean).join(" · ").slice(0, 320) || "可进入详情页查看实时进度与日志。";
  return { headline, detail };
}
