import {
  featureCoreToPrompt,
  isFeatureCoreComplete
} from "./homeComposerFeatureCore";
import { personalProfileToPrompt } from "./homeComposerProfile";
import { manuscriptCopyAll } from "./studioDeliverable";
import { getComposerPrefsFeatureCore, getStudioComposerPrefs } from "./studioWorkStorage";
import type { ManuscriptVersion, StudioWork } from "./studioWorkTypes";

/** Cursor 式 Rules：我的特色 + 创作约束（对话页配置，Studio 只读注入） */
export function buildStudioStyleRulesPrompt(work: StudioWork): string {
  const prefs = getStudioComposerPrefs();
  const lines: string[] = [
    "【Studio 对话规则】",
    "· 本区仅输出解释、追问与修改方向，不要贴可直接发布的完整成稿。",
    "· 成稿、改版预览、确认按钮在下方「产物」区，由用户确认后执行。",
    work.allowModelFallback
      ? "· 未绑资料时允许通识补充，须在回答中标注「待核实」。"
      : "· 未绑资料时不要编造具体事实。"
  ];

  const core = getComposerPrefsFeatureCore();
  const coreText = featureCoreToPrompt(core);
  if (prefs.personalEnabled && coreText) {
    lines.push("", "【我的特色 · Rules】", coreText);
  } else if (!isFeatureCoreComplete(core)) {
    lines.push(
      "",
      "【我的特色】尚未填写完整；勿虚构人设。用户可在对话页「我的特色」补充，成稿后系统会引导。"
    );
  }

  if (prefs.personalEnabled && prefs.personalProfile) {
    const sup = personalProfileToPrompt(prefs.personalProfile);
    if (sup) lines.push("", "【特色补充】", sup);
  }

  if (prefs.styleTemplateId) {
    lines.push("", `【写作习惯】模板 id：${prefs.styleTemplateId}`);
  }

  return lines.join("\n");
}

/** 本 Work 会话记忆（轮次摘要 + NotesAsk sessionState facts/prefs） */
export function buildStudioWorkMemoryPrompt(work: StudioWork): string {
  const lines: string[] = ["【本任务记忆】"];
  const turns = (work.agentTurns ?? []).filter((t) => !t.streaming && t.content.trim());
  const recent = turns.slice(-8);
  if (recent.length) {
    for (const t of recent) {
      const role = t.role === "user" ? "用户" : "助手";
      const snippet = t.content.trim().slice(0, 400);
      lines.push(`${role}：${snippet}`);
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

/** 当前稿件全文，供解读/改版意图注入（等同 Cursor @ 当前文件） */
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
  return "资料：未绑定（回答须标注依据不足或待核实）";
}
