/** 选题助手：将热点标题转为可填入创作框的讨论向度/子话题提示 */

export type HotTopicSourceId = "baidu" | "tencent" | "sina";

export function truncateTopicLabel(title: string, maxChars = 34): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1)}…`;
}

/**
 * 根据热点标题生成「可讨论话题」清单（不直接写整期播客分镜；不依赖外呼 LLM）。
 * 便于用户先选题、再决定是否与如何做成口播/对话播客。
 */
export function buildHotTopicDiscussableTopicsDraft(headline: string): string {
  const line = headline.replace(/\s+/g, " ").trim();
  return [
    `热点线索：${line}`,
    "",
    "下面是从该线索可拆出的讨论向度与子话题，供选题与对谈设计用（非事实陈述；成稿前请核对权威信源）：",
    "",
    "· **事实与信息边界**：已知信息有哪些、尚缺什么；仅有标题时如何把「确定 / 不确定」交代清楚，避免脑补细节。",
    "· **为何成为热点**：触动了哪些长期议题、利益结构或公众情绪；与同类历史事件可如何对照。",
    "· **利益相关方视角**：监管、平台、从业者、普通用户等各自可能关心或担忧什么；合理分歧可能在哪里。",
    "· **影响与推演**：若事件属实或延续发酵，对行业/日常生活有哪些可讨论的第二阶影响（避免未证实数字与定论）。",
    "· **对听众的价值**：可自查的线索、判断框架，或一条「冷静看待」的提醒；涉及灾情、伤亡等须克制与尊重。",
    "",
    "可从中任选 1～2 个角度做深聊，再决定体裁（口播/对话）、篇幅与是否引用具体报道。"
  ].join("\n");
}

/** @deprecated 使用 {@link buildHotTopicDiscussableTopicsDraft} */
export const buildHotTopicPodcastDraft = buildHotTopicDiscussableTopicsDraft;
