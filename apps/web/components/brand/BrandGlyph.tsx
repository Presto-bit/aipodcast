type Props = { className?: string; size?: number };

/** 轻量品牌图形：与侧栏品牌块一致的风格，用于空态等。 */
export default function BrandGlyph({ className = "", size = 48 }: Props) {
  const fontPx = Math.max(7, Math.round(size * 0.165));
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-dawn-lg bg-[var(--dawn-brand-glyph-bg)] font-extrabold leading-none tracking-tight text-[var(--dawn-brand-glyph-ink)] shadow-soft ${className}`}
      style={{ width: size, height: size, fontSize: fontPx }}
      aria-hidden
    >
      PrestoAI
    </div>
  );
}
