import {
  featureCoreToPrompt,
  isFeatureCoreComplete
} from "./homeComposerFeatureCore";
import { personalProfileToPrompt } from "./homeComposerProfile";
import { buildStudioPlatformRulesPrompt } from "./studioPlatformRules";
import { manuscriptCopyAll } from "./studioDeliverable";
import { getComposerPrefsFeatureCore, getStudioComposerPrefs } from "./studioWorkStorage";
import type { ManuscriptVersion, StudioWork } from "./studioWorkTypes";
/** 用户级 Rules（对话页「我的特色」，Studio 只读） */
export function buildStudioUserRulesPrompt(): string {
  const prefs = getStudioComposerPrefs();
  const lines: string[] = [];
  const core = getComposerPrefsFeatureCore();
  const coreText = featureCoreToPrompt(core);

  if (prefs.personalEnabled && coreText) {
    lines.push("【用户 Rules · 我的特色】", coreText);
  } else if (!isFeatureCoreComplete(core)) {
    lines.push("【用户 Rules】我的特色未填完整；勿虚构人设。");
  }

  if (prefs.personalEnabled && prefs.personalProfile) {
    const sup = personalProfileToPrompt(prefs.personalProfile);
    if (sup) lines.push("【用户 Rules · 补充】", sup);
  }

  if (prefs.styleTemplateId) {
    lines.push(`【写作习惯】模板：${prefs.styleTemplateId}`);
  }

  return lines.join("\n");
}

/** 本 Work 任务级 Rules（计划目标等，无单独输入 UI） */
export function buildStudioWorkRulesPrompt(work: StudioWork): string {
  const lines: string[] = [];
  if (work.workRules?.trim()) {
    lines.push("【任务 Rules】", work.workRules.trim());
  }
  if (work.plan?.goal?.trim()) {
    lines.push("【任务范围】", work.plan.goal.trim());
  }
  if (work.allowModelFallback) {
    lines.push("【任务约束】允许在未绑资料时使用通识补充，须标注待核实。");
  } else {
    lines.push("【任务约束】未绑资料时不要编造具体事实。");
  }
  return lines.filter(Boolean).join("\n");
}

/** 分层 Rules：平台 + 用户 + 任务 */
export function buildStudioLayeredRulesPrompt(work: StudioWork): string {
  return [
    buildStudioPlatformRulesPrompt(),
    buildStudioUserRulesPrompt(),
    buildStudioWorkRulesPrompt(work)
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** @deprecated 使用 buildStudioLayeredRulesPrompt */
export function buildStudioStyleRulesPrompt(work: StudioWork): string {
  return buildStudioLayeredRulesPrompt(work);
}

export function buildStudioWorkMemoryPrompt(work: StudioWork): string {
  const lines: string[] = ["【本任务记忆】"];
  const turns = (work.agentTurns ?? []).filter((t) => !t.streaming && t.content.trim());
  const recent = turns.slice(-8);
  if (recent.length) {
    for (const t of recent) {
      const role = t.role === "user" ? "用户" : "助手";
      lines.push(`${role}：${t.content.trim().slice(0, 400)}`);
    }
  } else {
    lines.push("（尚无对话）");
  }

  const st = work.agentSessionState;
  if (st?.topic?.trim()) lines.push(`主题锚点：${st.topic.trim()}`);
  if (st?.facts?.length) lines.push(`事实：${st.facts.slice(0, 6).join("；")}`);
  if (st?.prefs?.length) lines.push(`偏好：${st.prefs.slice(0, 6).join("；")}`);

  return lines.join("\n");
}

export function manuscriptVersionToPrompt(version: ManuscriptVersion | null): string {
  if (!version?.blocks.length) return "";
  return [
    `【当前稿件 · ${version.label}】`,
    manuscriptCopyAll(version.blocks).slice(0, 6000)
  ].join("\n");
}

export function corpusBindingLine(work: StudioWork): string {
  if (work.binding.notebook.trim() && work.binding.noteIds.length > 0) {
    return `资料：${work.binding.notebook} · ${work.binding.noteIds.length} 篇（RAG）`;
  }
  return "资料：未绑定";
}
