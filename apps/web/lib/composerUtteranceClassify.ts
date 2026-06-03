/** 区分专家模式下的「任务开工」与「普通询问」 */

import type { PlatformExpertId } from "./homeComposerExpertTypes";

export type UtteranceKind = "task" | "chat" | "clarify" | "revise";

const TASK_VERBS =
  /写|生成|出(一)?版|做成|帮我发|给一|出稿|整理成|改成.*笔记|做成.*笔记|发布|起草|撰写|输出|来一/i;
const QUESTION =
  /^(什么|为何|为什么|怎么理解|是什么|靠谱吗|区别|吗[？?]?$|呢[？?]?$|行不行|怎么样|如何理解|能不能解释|什么意思)/;
const CHAT_HINTS = /你觉得|帮我看看|这样行吗|理解一下|总结一下|资料里|有没有|解释|分析|对比下|区别是什么/i;
const REVISE_HINTS = /改(一下|改|短|长|标题|正文)|换(一个)?标题|缩短|更口语|更正式|重新生成|再来一版/i;
const DELIVERABLE_NOUNS = /笔记|小红书|红书|公众号|口播|脚本|播客|shownotes|标题|正文|tag|话题/i;

export function classifyUtterance(
  text: string,
  ctx: {
    expertSelected: boolean;
    hasDeliverableInSession?: boolean;
  }
): { kind: UtteranceKind; reason?: string } {
  const q = text.trim();
  if (!q) return { kind: "chat" };

  if (ctx.hasDeliverableInSession && REVISE_HINTS.test(q) && q.length < 80) {
    return { kind: "revise", reason: "修订上一版" };
  }

  const isQuestion = QUESTION.test(q) || (/[？?]$/.test(q) && !TASK_VERBS.test(q));
  const hasChatHint = CHAT_HINTS.test(q);
  const hasTaskVerb = TASK_VERBS.test(q);
  const hasDeliverableNoun = DELIVERABLE_NOUNS.test(q);
  const isShort = q.length < 12;

  if (isShort && !hasTaskVerb) {
    return { kind: "clarify", reason: "句子过短" };
  }

  if (isQuestion && !hasTaskVerb) {
    return { kind: "chat", reason: "疑问句" };
  }

  if (hasChatHint && !hasTaskVerb) {
    return { kind: "chat", reason: "讨论/理解" };
  }

  if (hasTaskVerb || (hasDeliverableNoun && q.length >= 15 && /把|将|给|帮/.test(q))) {
    return { kind: "task", reason: "交付请求" };
  }

  if (ctx.expertSelected && hasDeliverableNoun && q.length >= 10 && !isQuestion) {
    return { kind: "clarify", reason: "专家已选但意图不明" };
  }

  if (!ctx.expertSelected) {
    return { kind: "chat", reason: "未选专家默认聊天" };
  }

  return { kind: "clarify", reason: "默认澄清" };
}

export function inferResolutionConfidence(taskSentence: string, intakeFilled: boolean): "high" | "low" {
  const len = taskSentence.trim().length;
  if (len >= 32 && intakeFilled) return "high";
  if (len >= 24 && /把|将|写成|生成|出稿/.test(taskSentence)) return "high";
  return "low";
}

export type CreationIntent = {
  expertId: PlatformExpertId;
  message: string;
  label: string;
};

const INTENT_RULES: Array<{
  expertId: PlatformExpertId;
  label: string;
  message: string;
  pattern: RegExp;
}> = [
  {
    expertId: "xhs_ops",
    label: "红书搭子",
    message: "看起来要发小红书笔记",
    pattern: /小红书|红书|笔记|种草|话题|tag|#|薯/i
  },
  {
    expertId: "mp_ops",
    label: "公号笔杆子",
    message: "看起来要写公众号长文",
    pattern: /公众号|订阅号|长文|转发|摘要|图文/i
  },
  {
    expertId: "voice_gen",
    label: "口播编剧",
    message: "看起来要写短视频口播",
    pattern: /口播|短视频|分镜|60\s*秒|45\s*秒|抖音|视频脚本/i
  },
  {
    expertId: "podcast_plan",
    label: "播客主理",
    message: "看起来要策划播客节目",
    pattern: /播客|提纲|shownotes|双人对话|节目大纲/i
  }
];

export function detectCreationIntent(text: string): CreationIntent | null {
  const q = text.trim();
  if (q.length < 8) return null;
  if (QUESTION.test(q) && !TASK_VERBS.test(q)) return null;
  if (CHAT_HINTS.test(q) && !TASK_VERBS.test(q)) return null;

  const taskLike = TASK_VERBS.test(q) || (DELIVERABLE_NOUNS.test(q) && q.length >= 12);
  if (!taskLike) return null;

  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(q)) {
      return { expertId: rule.expertId, label: rule.label, message: rule.message };
    }
  }
  if (TASK_VERBS.test(q)) {
    return {
      expertId: "xhs_ops",
      label: "红书搭子",
      message: "看起来要做一篇可发布的内容"
    };
  }
  return null;
}
