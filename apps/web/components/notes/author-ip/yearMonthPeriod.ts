/** 经历时间段：YYYY-MM 起止，存储为 "2020-03 — 2023-06" 或 "2020-03 — 至今" */

export type YearMonthPeriod = {
  start: string;
  end: string;
  present: boolean;
};

const YM_RE = /^(\d{4})-(\d{2})$/;

export function buildMonthOptions(yearsBack = 40): { value: string; label: string }[] {
  const now = new Date();
  const endYear = now.getFullYear() + 1;
  const startYear = endYear - yearsBack;
  const out: { value: string; label: string }[] = [];
  for (let y = endYear; y >= startYear; y -= 1) {
    for (let m = 12; m >= 1; m -= 1) {
      const mm = String(m).padStart(2, "0");
      out.push({ value: `${y}-${mm}`, label: `${y}年${m}月` });
    }
  }
  return out;
}

export const YEAR_MONTH_OPTIONS = buildMonthOptions();

export function formatPeriod(p: YearMonthPeriod): string {
  const start = p.start.trim();
  if (!start) return "";
  if (p.present) return `${start} — 至今`;
  const end = p.end.trim();
  if (!end) return start;
  return `${start} — ${end}`;
}

export function parsePeriod(raw: string): YearMonthPeriod {
  const text = (raw || "").trim();
  if (!text) return { start: "", end: "", present: false };
  const present = /至今/.test(text);
  const parts = text.split(/[—–\-~至]+/).map((s) => s.trim()).filter(Boolean);
  const pickYm = (s: string): string => {
    const m = s.match(/(\d{4})[年.\-/]?(\d{1,2})/);
    if (!m) return "";
    const mm = String(Number(m[2])).padStart(2, "0");
    const candidate = `${m[1]}-${mm}`;
    return YM_RE.test(candidate) ? candidate : "";
  };
  const start = pickYm(parts[0] || text);
  const end = present ? "" : pickYm(parts[1] || "");
  return { start, end, present };
}

export function periodSelectClassName(): string {
  return "mt-1 w-full rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-sm";
}
