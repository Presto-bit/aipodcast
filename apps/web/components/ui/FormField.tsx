import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
};

/** 将校验与说明贴近控件，避免仅在页顶一条红字。 */
export default function FormField({ id, label, hint, error, children, className }: Props) {
  const errId = error && id ? `${id}-error` : undefined;
  const hintId = hint && id ? `${id}-hint` : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <div className={error ? "rounded-dawn-md ring-2 ring-danger/35 ring-offset-1 ring-offset-canvas" : ""}>
        {children}
      </div>
      {error ? (
        <p id={errId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
