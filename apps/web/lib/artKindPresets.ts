/** 笔记「生成文章」体裁，与 legacy ART_KIND_PRESETS 对齐 */
export type ArtKindKey = "custom" | "brief" | "blog" | "guide";

export const ART_KIND_PRESETS: Record<
  ArtKindKey,
  { label: string; textPrefix: string; programName: string | null }
> = {
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
