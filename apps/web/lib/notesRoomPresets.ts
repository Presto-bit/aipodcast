/** 对齐 legacy frontend PodcastGenerator PODCAST_ROOM_PRESETS（笔记房间体裁） */
export type PodcastRoomPresetKey = "custom" | "deep_dive" | "critique" | "debate";

export const PODCAST_ROOM_PRESETS: Record<
  PodcastRoomPresetKey,
  { label: string; textPrefix: string; scriptStyle: string | null; programName: string | null }
> = {
  custom: {
    label: "深夜聊天",
    textPrefix:
      "请围绕所选笔记做轻松、口语化的对谈；语气自然，可有简短附和或停顿感。抓住一条主线聊透即可，不必覆盖笔记全部细节；避免书面长句与套话堆砌。",
    scriptStyle: "深夜轻聊、口语自然",
    programName: "深夜聊天"
  },
  deep_dive: {
    label: "深度讨论",
    textPrefix:
      "请进行一场深度的技术研讨。专注于文档中的原始数据和实验方法，减少寒暄和幽默，用专业严谨的口吻分析论点之间的逻辑关系，并对结论进行批判性思考。",
    scriptStyle: "专业严谨、技术研讨、批判性分析",
    programName: "深度讨论"
  },
  critique: {
    label: "快速概览",
    textPrefix:
      "请针对这份文档做一个5分钟的快速简报。直接跳过背景介绍，重点讲述最核心的三个结论和对应的行动建议。语言要精炼，像是在为CEO做汇报。",
    scriptStyle: "精炼简报、结论与行动项",
    programName: "快速概览"
  },
  debate: {
    label: "多视角评价",
    textPrefix:
      "请针对文档中的观点进行一场辩论。一位主持人表示支持，另一位则持怀疑态度并提出挑战性的问题。重点探讨该方案可能存在的风险和局限性。",
    scriptStyle: "双视角交锋、风险与局限",
    programName: "多视角评价"
  }
};

/** 与历史命名 PODCAST_ROOM_DEFAULT_PROMPTS 同义 */
export const PODCAST_ROOM_DEFAULT_PROMPTS = PODCAST_ROOM_PRESETS;
