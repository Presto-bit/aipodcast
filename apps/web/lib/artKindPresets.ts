/** 笔记「生成文章」体裁，与 legacy ART_KIND_PRESETS 对齐 */
export type ArtKindKey = "custom" | "xiaohongshu" | "brief" | "blog" | "guide";

const XIAOHONGSHU_ART_PREFIX = `# 角色
你是一名拥有百万粉丝的小红书资深内容主编，擅长捕捉热点、制造情绪共鸣，并在视觉排版上极具审美。

# 任务
请写为一篇具有爆款潜力的小红书笔记。

1. **首图设计建议**：请给出 2-3 种视觉构图建议（包含封面文字标题、滤镜风格、画面元素），要求一眼吸睛。
2. **爆款标题**：请给出 5 个不同类型的标题（包含：利益诱惑型、焦虑缓解型、数字直观型、反直觉冲突型）。
3. **正文改写**：
   - 采用“黄金开头”，前两行必须抓住注意力。
   - 内容采用“分点式”排版，条理清晰，每段不超过 3 行。
   - 语言口语化，多用“你”、“咱们”、“救命”、“亲测”等词汇。
   - 在关键句和段落首尾加入大量相关的 Emoji（如：✨、📌、✅、🔥）。
4. **互动闭环**：在文末设计一个引导用户评论、点赞或收藏的“钩子”。
5. **热门话题标签**：列出 10 个精准的垂直话题 #Tag。`;

export const ART_KIND_PRESETS: Record<
  ArtKindKey,
  { label: string; textPrefix: string; programName: string | null }
> = {
  custom: {
    label: "私人订制",
    textPrefix: "",
    programName: "笔记文章 · 私人订制"
  },
  xiaohongshu: {
    label: "小红书爆款",
    textPrefix: XIAOHONGSHU_ART_PREFIX,
    programName: "笔记文章 · 小红书爆款"
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
