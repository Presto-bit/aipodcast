import type { SocialPublishDraft, SocialPublishPlatform } from "./socialPublishTypes";

export function buildSocialPublishClipboardText(draft: SocialPublishDraft): string {
  const title = draft.titles[draft.selectedTitleIndex] || draft.titles[0] || "";
  const parts = [
    `【标题】\n${draft.coverHook || title}`,
    draft.opening30 ? `【开头】\n${draft.opening30}` : "",
    `【正文】\n${draft.body.trim()}`
  ].filter(Boolean);
  if (draft.imageSuggestions.length) {
    parts.push(
      `【图片制作建议】\n${draft.imageSuggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    );
  }
  return parts.join("\n\n---\n\n");
}

export function copyGuideLines(platform: SocialPublishPlatform): string[] {
  if (platform === "xiaohongshu") {
    return [
      "打开小红书 App",
      "点底部 ＋ → 图文笔记",
      "粘贴正文（已含话题与互动句）",
      "按图片建议配图后发布"
    ];
  }
  return [
    "登录微信公众平台",
    "素材管理 → 新建图文",
    "粘贴标题与正文（已含话题与互动引导）",
    "按图片建议设置头图与文内配图后发布"
  ];
}
