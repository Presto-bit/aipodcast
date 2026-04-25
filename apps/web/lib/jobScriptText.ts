import { coerceJobResult } from "./coerceJobResult";

type JobArtifactRow = { id?: string | number; artifact_type?: string };

/** 列表/部分任务在 result 里只有约 240 字的 preview；高于此阈值视为 result.script_text 已是全文。 */
export const SCRIPT_TEXT_LIKELY_FULL_MIN_LEN = 280;

/**
 * 完整正文：`script_text` 足够长时直接用；否则拉取 `artifact_type === "script"` 的工件（全文仅在对象存储时）。
 */
export async function resolveJobScriptBodyText(
  jobId: string,
  row: Record<string, unknown>,
  authHdr: Record<string, string>
): Promise<string> {
  const result = coerceJobResult(row.result);
  const fromResult = String(result.script_text || "").trim();
  if (fromResult.length >= SCRIPT_TEXT_LIKELY_FULL_MIN_LEN) {
    return fromResult;
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
        const t = (await res.text()).trim();
        if (t) return t;
      }
    } catch {
      // 回退到 result 内字段
    }
  }
  if (fromResult) return fromResult;
  return String(result.preview || result.script_preview || "").trim();
}
