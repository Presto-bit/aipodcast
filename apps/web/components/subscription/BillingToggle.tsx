type Props = {
  cycle: "monthly" | "yearly";
  onChange: (c: "monthly" | "yearly") => void;
  yearlyDiscountPercent?: number;
};

export function BillingToggle({ cycle, onChange, yearlyDiscountPercent }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <div
        className="inline-flex rounded-xl border border-line bg-fill/60 p-1 shadow-sm"
        role="group"
        aria-label="计费周期"
      >
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            cycle === "monthly" ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
          onClick={() => onChange("monthly")}
        >
          连续包月
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            cycle === "yearly" ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
          onClick={() => onChange("yearly")}
        >
          连续包年
        </button>
      </div>
      {typeof yearlyDiscountPercent === "number" && yearlyDiscountPercent > 0 ? (
        <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
          年付约省 {yearlyDiscountPercent}%
        </span>
      ) : null}
    </div>
  );
}
