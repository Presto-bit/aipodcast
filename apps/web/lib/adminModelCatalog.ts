/**
 * 后台「模型管理」展示：能力说明、与产品功能的对应关系及计费说明。
 * 实际用量与账单以云厂商 / MiniMax 控制台为准；此处为产品与运维对照表。
 *
 * 用量分项与 CNY 估算由编排器写入 usage_events.meta（见 orchestrator usage_billing.py），
 * 定价参考：https://platform.minimaxi.com/docs/guides/pricing-paygo
 */

export type UsageCostField = "llm" | "tts" | "image" | "fixed" | "none";

export type AdminModelRow = {
  id: string;
  name: string;
  /** 模型分类（文本/语音/图像等） */
  category: string;
  /** 用量说明 */
  usage: string;
  /** 费用 / 计费方式说明 */
  billing: string;
  /** 无 meta 估算时退回：按任务数 × 单价（fixed/none 时使用） */
  estimatedUnitCostCny: number;
  /** 从 usage 汇总行上累加的预算字段 */
  costField: UsageCostField;
  /** 对应站内功能或任务类型 */
  features: string[];
  /** 对应 job_type，用于从 usage_events 聚合 */
  jobTypes: string[];
  /** 点击模型名展开时展示的补充细节 */
  details: string[];
};

export const ADMIN_MODEL_CATALOG: AdminModelRow[] = [
  {
    id: "minimax-text",
    name: "MiniMax 文本生成",
    category: "文本模型",
    usage: "脚本生成、润色、对话式播客稿等，按提示与输出 token 计量。",
    billing:
      "文本按量：输入/输出（及可选缓存读写）以元/百万 tokens 计费，如 MiniMax-M2.7 为 2.1 / 8.4，见 https://platform.minimaxi.com/docs/guides/pricing-paygo ；本站用 1600 中文字符≈1000 tokens 近似折算。",
    estimatedUnitCostCny: 0.06,
    costField: "llm",
    features: ["podcast_generate", "script_draft", "PolishTtsText（TTS 页润色）", "笔记播客脚本"],
    jobTypes: ["podcast_generate", "script_draft", "polish_tts_text", "note_podcast_script"],
    details: [
      "按输入/输出 token 计费；长文稿与多轮生成会显著增加 token。",
      "建议结合成功率观察重试任务，避免重复消耗。"
    ]
  },
  {
    id: "minimax-tts",
    name: "MiniMax 语音合成（TTS）",
    category: "语音模型",
    usage: "单说话人/多角色播客朗读、音色试听等，按字符或时长计费。",
    billing:
      "同步 / 异步 T2A：HD 约 3.5 元/万字符，turbo 约 2 元/万字符（供应商计费字符规则见文档）；播客成片 task 的 TTS 用量体现在本行。",
    estimatedUnitCostCny: 0.12,
    costField: "tts",
    features: ["text_to_speech", "tts", "播客成片朗读", "音色预览"],
    jobTypes: ["text_to_speech", "tts", "podcast_generate_tts", "podcast_generate", "podcast"],
    details: [
      "按字符数/时长计费，多段拼接音频会累计计费。",
      "可优先监控高时长任务，控制合成成本。"
    ]
  },
  {
    id: "minimax-voice-clone",
    name: "MiniMax 音色克隆",
    category: "语音模型",
    usage: "上传参考音频生成自定义音色，按次或按模型规则计费。",
    billing: "音色设计 / 快速复刻按次（约 9.9 元/音色，首次用于合成时扣费，以文档为准）。",
    estimatedUnitCostCny: 9.9,
    costField: "fixed",
    features: ["voice_clone / clone_voice", "音色管理"],
    jobTypes: ["voice_clone", "clone_voice"],
    details: [
      "通常按次收费，且可能受参考音频时长与质量影响。",
      "建议限制低质量样本重试次数，减少无效调用。"
    ]
  },
  {
    id: "minimax-image",
    name: "封面 / 配图生成（可选）",
    category: "图像模型",
    usage: "部分流程为播客或 TTS 结果生成封面图。",
    billing: "image-01 / live 等约 0.025 元/张（以文档为准）；与脚本/TTS 同任务时计入 image_cost_cny。",
    estimatedUnitCostCny: 0.025,
    costField: "image",
    features: ["podcast / TTS 封面", "works 展示图"],
    jobTypes: ["cover_image", "image_generate"],
    details: [
      "图像生成通常按张计费，高分辨率/高质量档位成本更高。",
      "建议后台按需开启，避免默认全量生成。"
    ]
  },
  {
    id: "local-rq",
    name: "本地队列与编排（无云模型）",
    category: "基础设施",
    usage: "任务排队、事件流、产物存储；不直接产生模型 token。",
    billing: "基础设施成本（Redis、对象存储、计算）按部署环境计。",
    estimatedUnitCostCny: 0,
    costField: "none",
    features: ["任务编排", "artifacts", "SSE 事件流"],
    jobTypes: [],
    details: [
      "本项不计入云模型账单，但会消耗计算与存储资源。",
      "可结合实例负载和对象存储账单单独核算。"
    ]
  }
];
