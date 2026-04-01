import type { ReactNode } from "react";
import BrandGlyph from "../brand/BrandGlyph";

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** 无自定义 icon 时展示品牌色块 */
  showBrandGlyph?: boolean;
  action?: ReactNode;
  className?: string;
};

export default function EmptyState({
  title,
  description,
  icon,
  showBrandGlyph = true,
  action,
  className = ""
}: Props) {
  const mark = icon ? (
    <div className="mb-3 text-4xl opacity-80">{icon}</div>
  ) : showBrandGlyph ? (
    <div className="mb-4">
      <BrandGlyph size={56} className="mx-auto shadow-card" />
    </div>
  ) : null;

  return (
    <div
      className={`fym-empty-state flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}
    >
      {mark}
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
