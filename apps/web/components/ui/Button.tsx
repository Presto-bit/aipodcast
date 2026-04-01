import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  /** 禁用时展示在原生 tooltip，便于理解「为什么点不了」 */
  disabledReason?: string;
  /** 若 loading 为 true，仍渲染 children；为 false 时可替换为 busyLabel */
  busyLabel?: ReactNode;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-dawn-md px-3.5 py-2 text-sm font-semibold tracking-[0.01em] transition-[background-color,border-color,box-shadow,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white shadow-[var(--dawn-shadow-soft)] hover:bg-brand/90 hover:shadow-[var(--dawn-shadow-card)] disabled:opacity-45",
  secondary:
    "border border-line bg-surface text-ink shadow-[var(--dawn-shadow-soft)] hover:bg-fill disabled:opacity-45 dark:bg-surface/80",
  danger:
    "border border-danger/40 bg-danger-soft text-danger shadow-[var(--dawn-shadow-soft)] hover:bg-danger/20 disabled:opacity-45 dark:text-rose-200",
  ghost: "text-ink hover:bg-fill disabled:opacity-45"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    loading = false,
    disabled,
    disabledReason,
    busyLabel,
    className,
    children,
    type = "button",
    ...rest
  },
  ref
) {
  const isDisabled = Boolean(disabled || loading);
  const title = isDisabled && disabledReason ? disabledReason : rest.title;
  const showBusy = loading && busyLabel != null;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      title={title}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], className)}
      {...rest}
    >
      {loading ? <span className="fym-spinner inline-block shrink-0" aria-hidden /> : null}
      {showBusy ? busyLabel : children}
    </button>
  );
});
