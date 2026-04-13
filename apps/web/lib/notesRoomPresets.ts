/** 对齐 legacy frontend PodcastGenerator PODCAST_ROOM_PRESETS（笔记房间体裁） */
export type PodcastRoomPresetKey = "custom" | "deep_dive" | "critique" | "debate";

export const PODCAST_ROOM_PRESETS: Record<
  PodcastRoomPresetKey,
  { label: string; textPrefix: string; scriptStyle: string | null; programName: string | null }
> = {
  custom: {
    label: "自定义模式",
    textPrefix: "",
    scriptStyle: null,
    programName: null
  },
  deep_dive: {
    label: "学霸模式",
    textPrefix:
      "【体裁：知识分享 Deep Dive】请将笔记材料转化为知识讲解类播客：结构清晰、循序渐进，帮助听众建立系统理解。",
    scriptStyle: "深入浅出、条理清晰、适合系统学习的知识分享类播客",
    programName: "学霸模式 · Deep Dive"
  },
  critique: {
    label: "锐评频道",
    textPrefix:
      "【体裁：观点点评】请基于笔记材料做有态度、有观点的播客点评，观点可鲜明，但保持可听性与基本尊重。",
    scriptStyle: "观点鲜明、有态度、点评类播客",
    programName: "锐评频道 · Critique"
  },
  debate: {
    label: "左右互搏",
    textPrefix:
      "【体裁：双人对辩】请以两位角色就材料中的争议点或对立观点展开讨论与辩论，有交锋、有来回，保持可听性。",
    scriptStyle: "观点交锋、对话张力、辩论型双人播客",
    programName: "左右互搏 · Debate"
  }
};

/** 与历史命名 PODCAST_ROOM_DEFAULT_PROMPTS 同义 */
export const PODCAST_ROOM_DEFAULT_PROMPTS = PODCAST_ROOM_PRESETS;
