/** 选题助手：将热点标题转为可填入创作框的播客策划提示 */

export type HotTopicSourceId = "baidu" | "tencent" | "sina";

export function truncateTopicLabel(title: string, maxChars = 34): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

/**
 * 根据热点标题生成播客创作说明（不依赖外呼 LLM，便于稳定与时延）。
 */
export function buildHotTopicPodcastDraft(headline: string): string {
  const line = headline.replace(/\s+/g, " ").trim();
  return [
    `热点标题：${line}`,
    "",
    "请围绕上述热点策划一期口播或双人对话播客：",
    "· 开场约 30 秒交代「发生了什么、为何受关注」，若仅有标题可说明将结合公开报道边界展开；",
    "· 中段用对话或自问自答讲清「对普通人/行业意味着什么」，避免堆砌参数与未经核实的细节；",
    "· 结尾给出 2～3 条听众可自行查证的信息线索或冷静看待的提醒。",
    "",
    "语气像朋友聊天，不念通稿；涉及灾情、伤亡等保持克制与尊重。"
  ].join("\n");
}
