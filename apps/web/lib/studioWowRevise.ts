/** 产物区「优化调整」预设 — 走 revise Job，块级 patch */
export const STUDIO_WOW_REVISE_PRESETS = [
  {
    id: "sharp",
    label: "更犀利",
    opinion:
      "请把语气改得更犀利、有明确态度；强化标题与开头前两行的钩子，保留事实与结构不变。"
  },
  {
    id: "short",
    label: "更短",
    opinion: "请压缩全文约 30%，删冗余铺垫；每段不超过 60 字，信息密度更高。"
  },
  {
    id: "colloquial",
    label: "更像博主",
    opinion: "请改成真实博主口语：有代入感、少书面语，像在跟朋友分享经验。"
  },
  {
    id: "saveable",
    label: "更强收藏感",
    opinion: "请强化收藏向干货：分点更清晰、每点有可执行价值，结尾自然引导收藏。"
  }
] as const;
