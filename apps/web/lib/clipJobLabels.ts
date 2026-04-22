/** 剪辑工程转写 / 导出状态在稿面的可读文案（与 i18n clip.editor.*Status.* 对齐） */
export function clipJobLabel(
  t: (key: string) => string,
  prefix: "transcription" | "export",
  status: string | undefined
): string {
  const st = status || "idle";
  const key = `clip.editor.${prefix}Status.${st}`;
  const label = t(key);
  return label === key ? st : label;
}
