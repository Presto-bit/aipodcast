/** 成稿前规范化用户 brief：纠错、去噪、合并碎片句（对齐 Cursor 式输入理解） */

const TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
  [/小红树|小虹书|小紅書/g, "小红书"],
  [/种草的?文(?!案)/g, "种草笔记"],
  [/保温杯杯/g, "保温杯"],
  [/职场女性白领/g, "职场女性"],
  [/帮我写个|帮我写一条|帮我做一条/g, "帮我写一篇"]
];

export function normalizeStudioComposeBrief(text: string): string {
  let s = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
  if (!s) return "";

  for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }

  const lines = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (lines.length > 1 && lines.every((line) => line.length <= 36 && !/[。！？.!?]$/.test(line))) {
    s = lines.join("，");
  } else {
    s = lines.join("\n\n");
  }

  return s.slice(0, 2000);
}
