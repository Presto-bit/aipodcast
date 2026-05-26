"use client";

import {
  formatPeriodFromParts,
  MONTH_OPTIONS,
  parsePeriodParts,
  periodSelectClassName,
  YEAR_OPTIONS,
  type YearMonthPeriodParts
} from "./yearMonthPeriod";

type Props = {
  value: string;
  onChange: (period: string) => void;
};

export default function YearMonthRangePicker({ value, onChange }: Props) {
  const parsed = parsePeriodParts(value);

  const apply = (patch: Partial<YearMonthPeriodParts>) => {
    const next = { ...parsed, ...patch };
    if (patch.present === true) {
      next.endYear = "";
      next.endMonth = "";
    }
    onChange(formatPeriodFromParts(next));
  };

  return (
    <div className="mt-1 space-y-2">
      <div>
        <span className="text-[10px] text-muted">开始</span>
        <div className="mt-0.5 grid grid-cols-2 gap-2">
          <select
            className={periodSelectClassName()}
            value={parsed.startYear}
            onChange={(e) => apply({ startYear: e.target.value })}
          >
            <option value="">年</option>
            {YEAR_OPTIONS.map((o) => (
              <option key={`sy-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={periodSelectClassName()}
            value={parsed.startMonth}
            onChange={(e) => apply({ startMonth: e.target.value })}
          >
            <option value="">月</option>
            {MONTH_OPTIONS.map((o) => (
              <option key={`sm-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <span className="text-[10px] text-muted">结束</span>
        <div className="mt-0.5 grid grid-cols-2 gap-2">
          <select
            className={periodSelectClassName()}
            value={parsed.present ? "" : parsed.endYear}
            disabled={parsed.present}
            onChange={(e) => apply({ endYear: e.target.value, present: false })}
          >
            <option value="">年</option>
            {YEAR_OPTIONS.map((o) => (
              <option key={`ey-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={periodSelectClassName()}
            value={parsed.present ? "" : parsed.endMonth}
            disabled={parsed.present}
            onChange={(e) => apply({ endMonth: e.target.value, present: false })}
          >
            <option value="">月</option>
            {MONTH_OPTIONS.map((o) => (
              <option key={`em-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={parsed.present} onChange={(e) => apply({ present: e.target.checked })} />
        至今
      </label>
    </div>
  );
}
