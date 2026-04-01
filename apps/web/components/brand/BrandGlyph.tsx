type Props = { className?: string; size?: number };

/** 轻量品牌图形：与侧栏 FYV 块一致的风格，用于空态等。 */
export default function BrandGlyph({ className = "", size = 48 }: Props) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-dawn-lg bg-[var(--dawn-brand-gradient)] text-[10px] font-extrabold tracking-[0.08em] text-white shadow-[var(--dawn-shadow-soft)] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      FYV
    </div>
  );
}
