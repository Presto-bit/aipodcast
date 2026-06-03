import type { AssistantBlock, IntakeOption, PlatformExpertId } from "./homeComposerExpertTypes";

export type IntakeFieldDef = {
  fieldId: string;
  prompt: string;
  multi: boolean;
  minSelect?: number;
  maxSelect?: number;
  options: IntakeOption[];
  allowOther?: boolean;
  hint?: string;
};

export type IntakeStepDef = {
  step: number;
  theme: string;
  fields: IntakeFieldDef[];
};

export const EXPERT_META: Record<
  PlatformExpertId,
  { persona: string; methodology: string; toolchain: string }
> = {
  xhs_ops: {
    persona: "平台原生笔记操盘手，擅长可复制发布的笔记包，不编造数据",
    methodology: "受众 → 语气与长度 → 标题策略 → 正文结构 → 话题",
    toolchain: "资料 RAG（可选）· 红书模板 Job · 通识兜底（无资料时）"
  },
  mp_ops: {
    persona: "长文与转发结构顾问，擅长公众号可读性与转发语",
    methodology: "文体 → 结构 → 摘要/钩子 → 成稿",
    toolchain: "资料 RAG（可选）· 公号模板 Job · 通识兜底"
  },
  voice_gen: {
    persona: "短视频口播编剧，擅长抓人开头与口播节奏",
    methodology: "时长 → 平台 → 钩子 → 分镜稿",
    toolchain: "资料 RAG（可选）· 脚本 Job · 通识兜底"
  },
  podcast_plan: {
    persona: "播客节目策划，擅长结构与 shownotes",
    methodology: "形态 → 时长 → 深度 → 大纲/脚本",
    toolchain: "资料 RAG（可选）· 脚本 Job · 通识兜底"
  }
};

const XHS_INTAKE_STEPS: IntakeStepDef[] = [
  {
    step: 0,
    theme: "受众与目的",
    fields: [
      {
        fieldId: "audience",
        prompt: "主要写给谁看？",
        multi: true,
        minSelect: 1,
        options: [
          { id: "newcomer", label: "产品/行业新人" },
          { id: "peers", label: "同行从业者" },
          { id: "general", label: "泛用户/路人" }
        ],
        allowOther: true
      },
      {
        fieldId: "noteType",
        prompt: "笔记类型",
        multi: false,
        options: [
          { id: "howto", label: "干货教程" },
          { id: "story", label: "故事经历" },
          { id: "listicle", label: "清单体" }
        ]
      },
      {
        fieldId: "purpose",
        prompt: "这次主要目的",
        multi: true,
        minSelect: 1,
        options: [
          { id: "acquire", label: "获客拉新" },
          { id: "retain", label: "复盘沉淀" },
          { id: "brand", label: "建立个人品牌" }
        ]
      }
    ]
  },
  {
    step: 1,
    theme: "语气与形式",
    fields: [
      {
        fieldId: "tone",
        prompt: "语气",
        multi: false,
        options: [
          { id: "casual", label: "口语亲切" },
          { id: "pro", label: "专业克制" },
          { id: "sharp", label: "观点鲜明" }
        ]
      },
      {
        fieldId: "length",
        prompt: "正文长度",
        multi: false,
        options: [
          { id: "short", label: "短（约 300 字内）" },
          { id: "medium", label: "中（约 300–600 字）" },
          { id: "long", label: "长（600 字以上）" }
        ]
      },
      {
        fieldId: "titleCount",
        prompt: "标题数量",
        multi: false,
        options: [
          { id: "1", label: "1 个" },
          { id: "3", label: "3 个" },
          { id: "5", label: "5 个" }
        ]
      },
      {
        fieldId: "withHashtags",
        prompt: "是否带话题 tag",
        multi: false,
        options: [
          { id: "yes", label: "要带话题" },
          { id: "no", label: "不要话题" }
        ]
      }
    ]
  }
];

const MP_INTAKE_STEPS: IntakeStepDef[] = [
  {
    step: 0,
    theme: "文体与结构",
    fields: [
      {
        fieldId: "genre",
        prompt: "文体",
        multi: false,
        options: [
          { id: "opinion", label: "观点文" },
          { id: "tutorial", label: "教程体" },
          { id: "news", label: "资讯解读" }
        ]
      },
      {
        fieldId: "structure",
        prompt: "结构偏好",
        multi: false,
        options: [
          { id: "pyramid", label: "总分总" },
          { id: "progressive", label: "递进式" },
          { id: "qa", label: "问答体" }
        ]
      }
    ]
  }
];

export const EXPERT_INTAKE_STEPS: Partial<Record<PlatformExpertId, IntakeStepDef[]>> = {
  xhs_ops: XHS_INTAKE_STEPS,
  mp_ops: MP_INTAKE_STEPS,
  voice_gen: [
    {
      step: 0,
      theme: "时长与平台",
      fields: [
        {
          fieldId: "duration",
          prompt: "目标时长",
          multi: false,
          options: [
            { id: "30s", label: "约 30 秒" },
            { id: "60s", label: "约 60 秒" },
            { id: "90s", label: "90 秒以上" }
          ]
        },
        {
          fieldId: "platform",
          prompt: "主要平台",
          multi: false,
          options: [
            { id: "douyin", label: "抖音" },
            { id: "channels", label: "视频号" },
            { id: "other", label: "其他" }
          ]
        }
      ]
    }
  ],
  podcast_plan: [
    {
      step: 0,
      theme: "形态与时长",
      fields: [
        {
          fieldId: "format",
          prompt: "节目形态",
          multi: false,
          options: [
            { id: "solo", label: "单人" },
            { id: "duo", label: "双人对话" }
          ]
        },
        {
          fieldId: "duration",
          prompt: "目标时长",
          multi: false,
          options: [
            { id: "3m", label: "约 3 分钟" },
            { id: "10m", label: "约 10 分钟" },
            { id: "30m", label: "30 分钟以上" }
          ]
        }
      ]
    }
  ]
};

export function intakeStepsForExpert(expertId: PlatformExpertId): IntakeStepDef[] {
  return EXPERT_INTAKE_STEPS[expertId] ?? XHS_INTAKE_STEPS;
}

export function intakeTotalSteps(expertId: PlatformExpertId): number {
  return intakeStepsForExpert(expertId).length;
}

/** 规则预勾选（客户端 fallback，与后端规则对齐） */
export function inferIntakePreselection(
  expertId: PlatformExpertId,
  taskSentence: string
): { intake: Record<string, string | string[]>; skipStep2: boolean; hint?: string } {
  const text = taskSentence.toLowerCase();
  const intake: Record<string, string | string[]> = {};
  let hint: string | undefined;

  if (expertId === "xhs_ops") {
    const audience: string[] = [];
    if (/新人|小白|入门|初学者/.test(taskSentence)) audience.push("newcomer");
    if (/同行|从业者|内行|产品经理|运营/.test(taskSentence)) audience.push("peers");
    if (!audience.length) audience.push("general");
    intake.audience = audience;

    if (/清单|list|几条|几点/.test(taskSentence)) intake.noteType = "listicle";
    else if (/故事|经历|复盘/.test(taskSentence)) intake.noteType = "story";
    else intake.noteType = "howto";

    intake.purpose = /复盘|总结|回顾/.test(taskSentence) ? ["retain"] : ["acquire"];

    if (/口语|亲切|随意/.test(taskSentence)) intake.tone = "casual";
    else if (/专业|严谨/.test(taskSentence)) intake.tone = "pro";
    else intake.tone = "casual";

    intake.length = /短|60\s*秒|精简/.test(taskSentence) ? "short" : "medium";
    intake.titleCount = /3\s*个标题|三个标题|多标题/.test(taskSentence) ? "3" : "3";
    intake.withHashtags = /tag|话题|#/.test(text) ? "yes" : "yes";

    if (intake.noteType === "story" && audience.includes("peers")) {
      hint = "选「同行+故事/复盘」更适合深度案例体";
    }
  }

  const detailed = taskSentence.trim().length >= 24;
  const skipStep2 = expertId === "xhs_ops" && detailed && Boolean(intake.tone);
  return { intake, skipStep2, hint };
}

export function buildIntakeStepBlock(
  expertId: PlatformExpertId,
  stepIndex: number,
  intake: Record<string, string | string[]>,
  hint?: string
): Extract<AssistantBlock, { kind: "intake_step" }> {
  const steps = intakeStepsForExpert(expertId);
  const def = steps[stepIndex] ?? steps[0]!;
  const preselectedForField = (fieldId: string): string[] => {
    const val = intake[fieldId];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string" && val) return [val];
    return [];
  };

  return {
    kind: "intake_step",
    step: stepIndex + 1,
    total: steps.length,
    theme: def.theme,
    fields: def.fields.map((f, idx) => ({
      ...f,
      preselected: preselectedForField(f.fieldId),
      ...(idx === 0 && hint ? { hint } : {})
    }))
  };
}

export function expertStripBlock(expertId: PlatformExpertId): Extract<AssistantBlock, { kind: "expert_strip" }> {
  const meta = EXPERT_META[expertId];
  return {
    kind: "expert_strip",
    persona: meta.persona,
    methodology: meta.methodology,
    toolchain: meta.toolchain
  };
}

export function mergeIntakeField(
  intake: Record<string, string | string[]>,
  fieldId: string,
  value: string | string[],
  multi: boolean
): Record<string, string | string[]> {
  const next = { ...intake };
  if (multi) {
    next[fieldId] = Array.isArray(value) ? value : [value];
  } else {
    next[fieldId] = Array.isArray(value) ? value[0] ?? "" : value;
  }
  return next;
}

export function intakeFieldHint(expertId: PlatformExpertId, intake: Record<string, string | string[]>): string | undefined {
  if (expertId !== "xhs_ops") return undefined;
  const audience = Array.isArray(intake.audience) ? intake.audience : [intake.audience].filter(Boolean);
  if (audience.includes("peers") && (intake.noteType === "story" || intake.purpose?.toString().includes("retain"))) {
    return "选「同行+复盘/故事」更适合深度案例体";
  }
  return undefined;
}

/** 确认页仅展示用户已选 intake（无值字段省略） */
export function formatIntakeSelectionsForDisplay(
  expertId: PlatformExpertId,
  intake: Record<string, string | string[]>
): string[] {
  const lines: string[] = [];
  for (const step of intakeStepsForExpert(expertId)) {
    for (const field of step.fields) {
      const raw = intake[field.fieldId];
      if (raw == null || raw === "") continue;
      const ids = Array.isArray(raw) ? raw : [raw];
      const labels = ids
        .map((id) => field.options.find((o) => o.id === id)?.label ?? String(id))
        .filter(Boolean);
      if (!labels.length) continue;
      lines.push(`${field.prompt} ${labels.join("、")}`);
    }
  }
  return lines;
}
