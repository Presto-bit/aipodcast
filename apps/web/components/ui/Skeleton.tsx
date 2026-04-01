import { cn } from "../../lib/cn";

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={cn("h-4 animate-pulse rounded-dawn-sm bg-fill", className)} />;
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={cn("rounded-dawn-lg bg-fill/90", className)} />;
}
