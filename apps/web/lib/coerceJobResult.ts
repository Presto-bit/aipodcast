/** 编排器偶发将 JSONB 以字符串形式透出；统一为对象供播放/打包逻辑读取。 */
export function coerceJobResult(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return {};
    try {
      const j = JSON.parse(s) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) {
        return j as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}
