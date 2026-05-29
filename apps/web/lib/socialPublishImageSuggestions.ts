/** 将配图建议（字符串或 { position, description } 对象）格式化为可读一行。 */
export function formatSocialImageSuggestionLine(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    const pos = String(row.position ?? row.type ?? row.role ?? row.slot ?? "").trim();
    const desc = String(
      row.description ?? row.desc ?? row.text ?? row.content ?? row.detail ?? ""
    ).trim();
    const title = String(row.title ?? "").trim();
    if (pos && desc) return `${pos}：${desc}`.slice(0, 300);
    if (title && desc) return `${title}：${desc}`.slice(0, 300);
    if (desc) return desc.slice(0, 300);
    if (pos) return pos.slice(0, 300);
    if (title) return title.slice(0, 300);
    const parts = Object.values(row)
      .map((v) => String(v ?? "").trim())
      .filter(Boolean);
    return parts.join(" · ").slice(0, 300);
  }

  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("{") && (s.includes("position") || s.includes("description"))) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return formatSocialImageSuggestionLine(parsed);
      }
    } catch {
      const posM = /['"]position['"]\s*:\s*['"]([^'"]+)['"]/.exec(s);
      const descM = /['"]description['"]\s*:\s*['"]([^'"]+)['"]/.exec(s);
      const pos = posM?.[1]?.trim() ?? "";
      const desc = descM?.[1]?.trim() ?? "";
      if (pos && desc) return `${pos}：${desc}`.slice(0, 300);
      if (desc) return desc.slice(0, 300);
      if (pos) return pos.slice(0, 300);
    }
  }
  return s.slice(0, 300);
}

export function normalizeSocialImageSuggestions(raw: unknown, limit = 8): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const line = formatSocialImageSuggestionLine(item);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}
