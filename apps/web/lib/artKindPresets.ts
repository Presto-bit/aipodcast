/** 笔记「生成文章」体裁（含自媒体平台入口，走 social_publish_draft 任务） */
export type ArtKindKey = "xiaohongshu" | "wechat_mp" | "custom" | "brief" | "blog" | "guide";

export const SOCIAL_ART_KINDS: ArtKindKey[] = ["xiaohongshu", "wechat_mp"];

/** 生成文章弹窗：体裁选择顺序 */
export const ART_KIND_PICK_ORDER: ArtKindKey[] = [
  "xiaohongshu",
  "wechat_mp",
  "brief",
  "blog",
  "guide",
  "custom"
];

export function isSocialArtKind(k: ArtKindKey): k is "xiaohongshu" | "wechat_mp" {
  return k === "xiaohongshu" || k === "wechat_mp";
}

/** 走后端 note_studio（L0+片摘要），生成后填入文章提词 */
export const STUDIO_ART_KINDS: ArtKindKey[] = ["brief"];

export function studioTaskForArtKind(k: ArtKindKey): string | null {
  if (STUDIO_ART_KINDS.includes(k)) return k;
  return null;
}

export function studioResponseToArtText(data: { markdown?: string }): string {
  return String(data.markdown || "").trim();
}

export const ART_KIND_PRESETS: Record<
  ArtKindKey,
  { label: string; textPrefix: string; programName: string | null; hint?: string }
> = {
  xiaohongshu: {
    label: "小红书",
    textPrefix: "",
    programName: null,
    hint: "标题·正文·话题·配图建议"
  },
  wechat_mp: {
    label: "微信公众号",
    textPrefix: "",
    programName: null,
    hint: "标题·摘要·分节正文"
  },
  custom: {
    label: "私人订制",
    textPrefix: "",
    programName: "笔记文章 · 私人订制"
  },
  brief: {
    label: "简报",
    textPrefix:
      "【体裁：简报】请基于所选笔记输出一篇结构紧凑的简报：开头一句概括，随后分条列出要点，每条不超过三行，避免冗长铺垫。",
    programName: "笔记文章 · 简报"
  },
  blog: {
    label: "博客长文",
    textPrefix:
      "【体裁：博客】请将笔记素材改写成一篇面向普通读者的博客长文：有引言、分段小标题、案例或比喻，语气自然可读。",
    programName: "笔记文章 · 博客"
  },
  guide: {
    label: "操作指南",
    textPrefix:
      "【体裁：指南】请输出可执行的操作指南：按步骤编号，每步说明目的与注意事项，必要时附「常见错误」小节。",
    programName: "笔记文章 · 指南"
  }
};

export function socialPlatformFromArtKind(k: ArtKindKey): "xiaohongshu" | "wechat_mp" {
  return k === "wechat_mp" ? "wechat_mp" : "xiaohongshu";
}
