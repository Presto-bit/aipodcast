"use client";

/** warm cache 导航时的顶部轻量进度条（非全屏骨架）。 */
export default function WorkbenchNavProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[300020] h-0.5 overflow-hidden bg-brand/10"
      role="progressbar"
      aria-label="页面切换中"
      aria-busy
    >
      <div className="h-full w-2/5 animate-[fym-nav-progress_0.85s_ease-in-out_infinite] rounded-full bg-brand" />
    </div>
  );
}
