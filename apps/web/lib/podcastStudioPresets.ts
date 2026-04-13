/**
 * 内置「加入创意」结构化模板（与播客工作室共用类型）。
 * 与 `creativeTemplates.ts` 中默认创意项合并为 `BUILTIN_CREATIVE_PRESETS`。
 */
import { DEFAULT_SCRIPT_CONSTRAINTS } from "./podcastStudioCommon";

export type PodcastStudioPreset = {
  id: string;
  label: string;
  description: string;
  /** 追加到 script_constraints 的素材前缀说明（可为空） */
  textPrefix: string;
  /** 自定义模板可缺省，由 creativeTemplates 回落到站点默认 */
  scriptStyle?: string;
  speaker1Persona?: string;
  speaker2Persona?: string;
  scriptConstraints?: string;
};

export const PODCAST_STUDIO_PRESETS: PodcastStudioPreset[] = [
  {
    id: "creative_style_news_digest",
    label: "新闻划重点",
    description: "高效梳理资讯：结论先行、少废话，适合热点与周报类素材。",
    textPrefix: "请用「一条主线 + 三个观察点」组织内容；开头 30 秒内交代本期要点。",
    scriptStyle: "节奏紧凑、信息密度高，适当用设问引出下一段。",
    speaker1Persona: "主持：快速定调，负责提问与收束。",
    speaker2Persona: "嘉宾：补充背景与数据，避免冗长铺垫。",
    scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
  },
  {
    id: "creative_style_casual_chat",
    label: "轻松闲聊",
    description: "朋友聊天感，适合生活方式、影评书摘与兴趣话题。",
    textPrefix: "允许适度跑题，但要能在 1–2 句内拉回主题；少用报告体。",
    scriptStyle: "轻松自然，口语化，可适度幽默，避免端着。",
    speaker1Persona: "好奇、会接梗，负责抛话题。",
    speaker2Persona: "会讲故事与细节，补充个人观感。",
    scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
  },
  {
    id: "creative_style_deep_dive",
    label: "深度解读",
    description: "把一个概念讲透：定义—反例—启发，适合知识向长素材。",
    textPrefix: "正文优先解释「为什么」和「怎么用」，少堆砌术语；必要时给一句类比。",
    scriptStyle: "逻辑链清晰，段落之间有明确过渡，语气稳重但不沉闷。",
    speaker1Persona: "引导结构：帮听众建立心智模型，负责小结。",
    speaker2Persona: "质疑与补洞：举反例、边界条件与实践坑。",
    scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
  },
  {
    id: "creative_style_beginner_friendly",
    label: "零基础友好",
    description: "面向完全外行：先举贴近生活的例子，再逐步收窄到核心概念。",
    textPrefix: "默认听众不理解专业背景；每个新概念先给直觉解释，再给正式说法。",
    scriptStyle: "耐心、亲切，句子偏短，避免连环从句。",
    speaker1Persona: "代表听众发问：把「听不懂」的点问出来。",
    speaker2Persona: "讲解员：用例子拆解步骤，避免炫技。",
    scriptConstraints: DEFAULT_SCRIPT_CONSTRAINTS
  }
];
