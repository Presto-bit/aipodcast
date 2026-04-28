const SENSITIVE_KEY = /token|secret|password|authorization|cookie|bearer|apikey|api_key/i;

function truncateStr(s: string, max: number): string {
  const t = String(s);
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 供服务端诊断日志使用：限制深度与长度，并对疑似敏感字段脱敏。 */
export function sanitizeClientDiagnosticsValue(value: unknown, maxDepth: number, maxString: number): unknown {
  if (maxDepth <= 0) return "[max-depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateStr(value, maxString);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((x) => sanitizeClientDiagnosticsValue(x, maxDepth - 1, Math.min(maxString, 2000)));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= 40) {
        out["_truncated"] = true;
        break;
      }
      const key = truncateStr(k, 64);
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = sanitizeClientDiagnosticsValue(v, maxDepth - 1, maxString);
    }
    return out;
  }
  return truncateStr(String(value), maxString);
}
