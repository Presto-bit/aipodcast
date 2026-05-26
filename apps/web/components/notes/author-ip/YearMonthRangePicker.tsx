"use client";

import { formatPeriod, parsePeriod, periodSelectClassName, YEAR_MONTH_OPTIONS, type YearMonthPeriod } from "./yearMonthPeriod";

type Props = {
  value: string;
  onChange: (period: string) => void;
};

export default function YearMonthRangePicker({ value, onChange }: Props) {
  const parsed = parsePeriod(value);

  const apply = (patch: Partial<YearMonthPeriod>) => {
    const next = { ...parsed, ...patch };
    if (patch.present === true) {
      next.end = "";
    }
    onChange(formatPeriod(next));
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-muted">开始</span>
          <select
            className={periodSelectClassName()}
            value={parsed.start || ""}
            onChange={(e) => apply({ start: e.target.value })}
          >
            <option value="">选择年月</option>
            {YEAR_MONTH_OPTIONS.map((o) => (
              <option key={`s-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] text-muted">结束</span>
          <select
            className={periodSelectClassName()}
            value={parsed.present ? "" : parsed.end || ""}
            disabled={parsed.present}
            onChange={(e) => apply({ end: e.target.value, present: false })}
          >
            <option value="">{parsed.present ? "至今" : "选择年月"}</option>
            {YEAR_MONTH_OPTIONS.map((o) => (
              <option key={`e-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={parsed.present}
          onChange={(e) => apply({ present: e.target.checked })}
        />
        至今
      </label>
    </div>
  );
}
