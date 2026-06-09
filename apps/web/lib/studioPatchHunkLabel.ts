/** 用户可读的 diff hunk 标签 */

export function patchHunkLabel(key: string): string {
  if (key === "title:0") return "标题";
  const bodyMatch = /^body:p:(\d+)$/.exec(key);
  if (bodyMatch) {
    const n = Number(bodyMatch[1]) + 1;
    return `正文第 ${n} 段`;
  }
  if (key.startsWith("body:line:")) return "正文行";
  if (key === "meta:hashtags") return "话题标签";
  if (key === "meta:interaction") return "互动引导";
  if (key === "meta:coverBrief") return "封面说明";
  if (key.startsWith("meta:")) return key.replace("meta:", "");
  return key.replace(":", " · ");
}
