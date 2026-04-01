/** 与 AI 播客工具条 chip 样式一致（晨曦主题 token） */
export function chipClass(active: boolean, size: "sm" | "lg" = "sm") {
  const sizing =
    size === "lg"
      ? "px-4 py-2 text-sm sm:px-5 sm:py-2.5 sm:text-base"
      : "px-3 py-1.5 text-xs";
  return [
    "rounded-full border font-medium transition-colors",
    sizing,
    active
      ? "border-brand bg-fill text-brand"
      : "border-line bg-surface text-ink hover:border-muted/50 hover:bg-fill"
  ].join(" ");
}
