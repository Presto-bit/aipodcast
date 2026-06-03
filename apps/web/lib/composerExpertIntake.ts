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
    theme: "读者与内容定位",
    fields: [
      {
        fieldId: "accountStage",
        prompt: "账号阶段（决定语气与 CTA 力度）",
        multi: false,
        options: [
          { id: "cold_start", label: "新号起号，需要快速建立认知" },
          { id: "steady", label: "稳定更新，巩固垂类标签" },
          { id: "convert", label: "已有粉丝，重点转化/变现" },
          { id: "brand", label: "品牌/企业号，偏官方可信" }
        ]
      },
      {
        fieldId: "audience",
        prompt: "理想读者是谁？他们此刻最愁什么",
        multi: true,
        minSelect: 1,
        options: [
          { id: "newcomer", label: "刚入门的小白/新人" },
          { id: "peers", label: "同行/从业者（要专业深度）" },
          { id: "buyer", label: "有购买/决策意向的用户" },
          { id: "general", label: "泛流量/路人（要3秒钩子）" }
        ],
        allowOther: true
      },
      {
        fieldId: "contentAngle",
        prompt: "内容切入角度",
        multi: false,
        options: [
          { id: "review", label: "测评种草（真实体验+优缺点）" },
          { id: "tutorial", label: "教程/SOP（步骤可照做）" },
          { id: "listicle", label: "避坑清单/盘点（收藏向）" },
          { id: "story", label: "经历故事（情绪共鸣）" },
          { id: "opinion", label: "观点态度（有立场、敢判断）" }
        ]
      },
      {
        fieldId: "publishGoal",
        prompt: "这篇发出去，你最想达成什么",
        multi: true,
        minSelect: 1,
        options: [
          { id: "expose", label: "曝光破圈、进推荐" },
          { id: "save", label: "高收藏（干货/清单）" },
          { id: "comment", label: "评论互动、要反馈" },
          { id: "dm", label: "引导私信/咨询" },
          { id: "follow", label: "涨粉关注" }
        ]
      }
    ]
  },
  {
    step: 1,
    theme: "结构与表达",
    fields: [
      {
        fieldId: "hookStyle",
        prompt: "开头钩子类型（前 3 秒/第一屏）",
        multi: false,
        options: [
          { id: "pain_question", label: "痛点提问（你是不是也…）" },
          { id: "number", label: "数字/结果先行（3步/7天/省50%）" },
          { id: "contrast", label: "反常识/对比（别再…/原来…）" },
          { id: "scene", label: "场景代入（打工人/宝妈/深夜…）" }
        ]
      },
      {
        fieldId: "structure",
        prompt: "正文结构偏好",
        multi: false,
        options: [
          { id: "bullet", label: "分点清单（· / ①②③）" },
          { id: "steps", label: "步骤教程（先后逻辑）" },
          { id: "story_arc", label: "故事线（背景→转折→收获）" },
          { id: "compare", label: "对比测评（A vs B / 前后）" }
        ]
      },
      {
        fieldId: "tone",
        prompt: "整体语气",
        multi: false,
        options: [
          { id: "casual", label: "口语亲切（像朋友聊天）" },
          { id: "pro", label: "专业克制（有依据、少夸张）" },
          { id: "sharp", label: "观点鲜明（敢下判断）" }
        ]
      },
      {
        fieldId: "length",
        prompt: "正文篇幅（不含标题与话题）",
        multi: false,
        options: [
          { id: "short", label: "短（约 250 字内，快刷向）" },
          { id: "medium", label: "中（250–500 字，主流笔记）" },
          { id: "long", label: "长（500 字以上，深度收藏）" }
        ]
      }
    ]
  },
  {
    step: 2,
    theme: "发布与视觉",
    fields: [
      {
        fieldId: "titleCount",
        prompt: "备选标题数量",
        multi: false,
        options: [
          { id: "1", label: "1 个（已定稿）" },
          { id: "3", label: "3 个（A/B 测点击）" },
          { id: "5", label: "5 个（多方向试）" }
        ]
      },
      {
        fieldId: "withHashtags",
        prompt: "话题 tag 策略",
        multi: false,
        options: [
          { id: "yes", label: "要带（垂类+流量词组合）" },
          { id: "no", label: "不要（靠内容自然流量）" }
        ]
      },
      {
        fieldId: "ctaStyle",
        prompt: "结尾行动引导",
        multi: false,
        options: [
          { id: "save", label: "求收藏（干货向）" },
          { id: "comment", label: "求评论/讨论" },
          { id: "soft_dm", label: "软引导私信（不硬广）" },
          { id: "none", label: "弱 CTA（自然结束）" }
        ]
      },
      {
        fieldId: "visualStyle",
        prompt: "配图/封面风格",
        multi: false,
        options: [
          { id: "big_type", label: "大字报封面 + 要点内页" },
          { id: "photo", label: "实拍/场景图为主" },
          { id: "screenshot", label: "截图标注/对比图" },
          { id: "infographic", label: "信息图/流程图" }
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
    if (/购买|下单|种草|测评/.test(taskSentence)) audience.push("buyer");
    if (!audience.length) audience.push("general");
    intake.audience = audience;

    intake.accountStage = /品牌|官方|企业/.test(taskSentence)
      ? "brand"
      : /变现|转化|私信/.test(taskSentence)
        ? "convert"
        : /起号|新号|从0/.test(taskSentence)
          ? "cold_start"
          : "steady";

    if (/清单|list|几条|几点|避坑/.test(taskSentence)) intake.contentAngle = "listicle";
    else if (/故事|经历|复盘/.test(taskSentence)) intake.contentAngle = "story";
    else if (/测评|对比|优缺点/.test(taskSentence)) intake.contentAngle = "review";
    else if (/观点|认为|其实/.test(taskSentence)) intake.contentAngle = "opinion";
    else intake.contentAngle = "tutorial";

    intake.noteType =
      intake.contentAngle === "listicle"
        ? "listicle"
        : intake.contentAngle === "story"
          ? "story"
          : "howto";

    const goals: string[] = [];
    if (/收藏|干货|清单/.test(taskSentence)) goals.push("save");
    if (/评论|互动|讨论/.test(taskSentence)) goals.push("comment");
    if (/私信|咨询|联系/.test(taskSentence)) goals.push("dm");
    if (/涨粉|关注/.test(taskSentence)) goals.push("follow");
    if (!goals.length) goals.push("expose");
    intake.publishGoal = goals;
    intake.purpose = /复盘|总结|回顾/.test(taskSentence) ? ["retain"] : ["acquire"];

    intake.hookStyle = /数字|\d+步|\d+天/.test(taskSentence)
      ? "number"
      : /场景|打工人|深夜/.test(taskSentence)
        ? "scene"
        : "pain_question";

    intake.structure =
      intake.contentAngle === "listicle"
        ? "bullet"
        : intake.contentAngle === "story"
          ? "story_arc"
          : intake.contentAngle === "review"
            ? "compare"
            : "steps";

    if (/口语|亲切|随意/.test(taskSentence)) intake.tone = "casual";
    else if (/专业|严谨/.test(taskSentence)) intake.tone = "pro";
    else intake.tone = "casual";

    intake.length = /短|精简/.test(taskSentence) ? "short" : "medium";
    intake.titleCount = /3\s*个标题|三个标题|多标题/.test(taskSentence) ? "3" : "3";
    intake.withHashtags = /tag|话题|#/.test(text) ? "yes" : "yes";
    intake.ctaStyle = /私信/.test(taskSentence) ? "soft_dm" : /评论/.test(taskSentence) ? "comment" : "save";
    intake.visualStyle = /截图|标注/.test(taskSentence) ? "screenshot" : "big_type";

    if (intake.contentAngle === "story" && audience.includes("peers")) {
      hint = "同行+经历故事更适合深度案例体，建议选中篇";
    }
  }

  const detailed = taskSentence.trim().length >= 32;
  const skipStep2 = expertId === "xhs_ops" && detailed && Boolean(intake.tone) && Boolean(intake.contentAngle);
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
