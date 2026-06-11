const OPS_SIGNAL =
  /运营|策略|涨粉|流量|算法|投放|转化|变现|引流|起号|养号|爆款|冷启动|人设|排期|首评|互动|矩阵|对标|复盘|小眼睛|收藏率|什么时候发|怎么推|推广方案|发布计划|发布节奏|发布后|怎么发/;

export function isOpsStrategyQuestion(message: string): boolean {
  return OPS_SIGNAL.test(message.trim());
}

/** 无稿件时：平台框架（不用 taskSentence 猜主题，避免旧 brief 污染） */
export function opsStrategyFallbackReply(message: string, _taskSentence = ""): string {
  void message;
  return [
    "以下为通用框架（尚未绑定具体笔记）。",
    "",
    "**发布时间**",
    "· 工作日晚 20:00–22:00 或午休 12:00 前后（按受众微调）",
    "· 首发后 30 分钟内留 1 条首评（具体问题，不要纯 emoji）",
    "",
    "**怎么推**",
    "· 话题：2 个垂类词 + 1 个场景词（须与笔记主题一致）",
    "· 冷启动：发完 2h 内回复前 5 条评论",
    "",
    "先描述成稿需求，我可以结合正文给「这篇怎么推」的具体方案。"
  ].join("\n");
}

/** 有稿时 LLM 失败兜底（仅摘要，不编泛化 tips） */
export function opsStrategyManuscriptFallback(excerpt: string): string {
  const snippet = excerpt.trim().slice(0, 160).replace(/\n/g, " ");
  return [
    "（未能生成完整运营方案，以下为基于当前稿件的简要建议）",
    "",
    snippet ? `**稿件摘要**：${snippet}…` : "",
    "",
    "· 首评：从正文痛点句改写成问句",
    "· 话题：用正文里的产品/场景词，避免与稿无关的泛标签",
    "",
    "可以说「按运营建议改标题」或「写一条首评」。"
  ]
    .filter(Boolean)
    .join("\n");
}

/** 有稿运营 reply 后 chips */
export const STUDIO_OPS_WITH_MANUSCRIPT_CHIPS = [
  "按运营建议改标题",
  "写一条首评文案",
  "再写一篇续集"
] as const;
