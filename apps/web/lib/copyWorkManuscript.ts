import { resolveJobManuscriptText, SCRIPT_TEXT_LIKELY_FULL_MIN_LEN } from "./jobScriptText";
import type { WorkItem } from "./worksTypes";

type CopyWorkHint = Pick<WorkItem, "scriptText" | "scriptCharCount" | "status">;

function scriptTextLikelyFull(work: CopyWorkHint): boolean {
  const text = String(work.scriptText || "").trim();
  if (!text) return false;
  const declared = work.scriptCharCount;
  if (typeof declared === "number" && Number.isFinite(declared) && declared > 0) {
    return text.length >= declared;
  }
  return text.length >= SCRIPT_TEXT_LIKELY_FULL_MIN_LEN;
}

/**
 * 将作品正文复制到剪贴板：列表 preview 足够长时免拉详情，否则走 resolveJobManuscriptText。
 */
export async function copyWorkManuscriptToClipboard(
  jobId: string,
  options: {
    authHeaders: Record<string, string>;
    work?: CopyWorkHint;
  }
): Promise<void> {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("无效作品 ID");

  const { authHeaders, work } = options;
  if (work && scriptTextLikelyFull(work)) {
    await navigator.clipboard.writeText(String(work.scriptText || "").trim());
    return;
  }

  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHeaders }
  });
  const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error("读取作品失败");
  }

  const succeeded = String(row.status || work?.status || "") === "succeeded";
  const text = (await resolveJobManuscriptText(id, row, authHeaders, { succeeded })).trim();
  if (!text) {
    throw new Error("暂无文稿可复制");
  }
  await navigator.clipboard.writeText(text);
}
