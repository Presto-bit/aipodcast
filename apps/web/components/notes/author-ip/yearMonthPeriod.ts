/** 经历时间段：存储为 "2020-03 — 2023-06" 或 "2020-03 — 至今" */

export type YearMonthPeriodParts = {
  startYear: string;
  startMonth: string;
  endYear: string;
  endMonth: string;
  present: boolean;
};

const YM_RE = /^(\d{4})-(\d{2})$/;

export function buildYearOptions(yearsBack = 50): { value: string; label: string }[] {
  const now = new Date().getFullYear();
  const out: { value: string; label: string }[] = [];
  for (let y = now + 1; y >= now - yearsBack; y -= 1) {
    out.push({ value: String(y), label: `${y}年` });
  }
  return out;
}

export const YEAR_OPTIONS = buildYearOptions();

export const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const m = i + 1;
  const mm = String(m).padStart(2, "0");
  return { value: mm, label: `${m}月` };
});

export function ymToParts(ym: string): { year: string; month: string } {
  const m = ym.match(YM_RE);
  if (!m) return { year: "", month: "" };
  return { year: m[1], month: m[2] };
}

export function partsToYm(year: string, month: string): string {
  if (!year || !month) return "";
  return `${year}-${month.padStart(2, "0")}`;
}

export function formatPeriodFromParts(p: YearMonthPeriodParts): string {
  const start = partsToYm(p.startYear, p.startMonth);
  if (!start) return "";
  if (p.present) return `${start} — 至今`;
  const end = partsToYm(p.endYear, p.endMonth);
  if (!end) return start;
  return `${start} — ${end}`;
}

export function parsePeriodParts(raw: string): YearMonthPeriodParts {
  const text = (raw || "").trim();
  if (!text) {
    return { startYear: "", startMonth: "", endYear: "", endMonth: "", present: false };
  }
  const present = /至今/.test(text);
  const parts = text.split(/[—–\-~至]+/).map((s) => s.trim()).filter(Boolean);
  const pickYm = (s: string): { year: string; month: string } => {
    const m = s.match(/(\d{4})[年.\-/]?(\d{1,2})/);
    if (!m) return { year: "", month: "" };
    const mm = String(Number(m[2])).padStart(2, "0");
    return { year: m[1], month: mm };
  };
  const start = pickYm(parts[0] || text);
  const end = present ? { year: "", month: "" } : pickYm(parts[1] || "");
  return {
    startYear: start.year,
    startMonth: start.month,
    endYear: end.year,
    endMonth: end.month,
    present
  };
}

export function periodSelectClassName(): string {
  return "w-full rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-sm";
}
