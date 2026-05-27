import { coerceJobResult } from "./coerceJobResult";

type JobArtifactRow = { id?: string | number; artifact_type?: string };

/** 列表/部分任务在 result 里只有约 240 字的 preview；低于此阈值时几乎肯定要从工件补全文。 */
export const SCRIPT_TEXT_LIKELY_FULL_MIN_LEN = 280;

function parseDeclaredScriptChars(result: Record<string, unknown>): number | null {
  const raw = result.script_char_count;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * 完整正文：优先用 `result.script_text`（当 `script_char_count` 表明已存全文时不再拉工件）；
 * 否则拉取 `artifact_type === "script"` 的工件；若工件比 result 内字段更长则用工件（避免
 * result 里只有中等长度截断却超过 280 字时被误判为全文）。
 */
export async function resolveJobScriptBodyText(
  jobId: string,
  row: Record<string, unknown>,
  authHdr: Record<string, string>
): Promise<string> {
  const result = coerceJobResult(row.result);
  const fromResult = String(result.script_text || "").trim();
  const previewFallback = String(result.preview || result.script_preview || "").trim();

  const declared = parseDeclaredScriptChars(result);
  if (declared != null && fromResult.length >= declared) {
    return fromResult || previewFallback;
  }

  const artifacts = (row.artifacts || []) as JobArtifactRow[];
  const scriptArt = artifacts.find((a) => String(a.artifact_type || "") === "script");
  if (scriptArt?.id != null && String(scriptArt.id).trim()) {
    const aid = encodeURIComponent(String(scriptArt.id).trim());
    const jid = encodeURIComponent(jobId);
    try {
      const res = await fetch(`/api/jobs/${jid}/artifacts/${aid}/download`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { ...authHdr }
      });
      if (res.ok) {
        const fromArtifact = (await res.text()).trim();
        if (fromArtifact.length > fromResult.length) {
          return fromArtifact;
        }
      }
    } catch {
      // 回退到 result 内字段
    }
  }

  if (fromResult) return fromResult;
  return previewFallback;
}

export function isSocialPublishDraftJobType(jobType: string | undefined): boolean {
  return String(jobType || "").trim().toLowerCase() === "social_publish_draft";
}

/** 自媒体发布稿终稿正文（result.body 已含话题与互动句） */
export function socialPublishBodyFromResult(result: Record<string, unknown>): string {
  return String(result.body || "").trim();
}

export function socialPublishTitleFromResult(result: Record<string, unknown>): string {
  const titles = result.titles;
  if (Array.isArray(titles)) {
    for (const t of titles) {
      const s = String(t).trim();
      if (s) return s;
    }
  }
  return String(result.cover_hook || result.title || "").trim();
}

/** 作品详情页正文：文章工件 / 自媒体 result.body */
export async function resolveJobManuscriptText(
  jobId: string,
  row: Record<string, unknown>,
  authHdr: Record<string, string>,
  options?: { succeeded?: boolean }
): Promise<string> {
  const jt = String(row.job_type || "").trim().toLowerCase();
  const result = coerceJobResult(row.result);
  if (isSocialPublishDraftJobType(jt)) {
    return socialPublishBodyFromResult(result);
  }
  const shortFrom = String(result.script_text || "").trim();
  if (options?.succeeded === false) {
    return shortFrom || String(result.preview || result.script_preview || "").trim();
  }
  if (shortFrom.length >= SCRIPT_TEXT_LIKELY_FULL_MIN_LEN) {
    return shortFrom;
  }
  return resolveJobScriptBodyText(jobId, row, authHdr);
}
