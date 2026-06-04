import type { FeatureCore } from "./homeComposerExpertTypes";
import {
  EMPTY_FEATURE_CORE,
  featureCoreComplete,
  isFeatureCoreComplete
} from "./homeComposerFeatureCore";
import { FEATURE_CORE_FIELDS } from "./homeComposerPersonalFields";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

export type FeatureCoreKey = keyof FeatureCore;

export function missingVoiceKeys(core: FeatureCore): FeatureCoreKey[] {
  return FEATURE_CORE_FIELDS.filter(({ key }) => !core[key].trim()).map(({ key }) => key);
}

export function voiceProgressLabel(core: FeatureCore): string {
  const n = featureCoreComplete(core);
  if (n >= 3) return "Voice 已齐";
  return `Voice ${n}/3`;
}

/** 注入 Agent：对话收集 Voice，不要求用户填表 */
export function studioVoiceAgentInstructions(work: StudioWork): string {
  if (isFeatureCoreComplete(work.featureCore)) {
    return "Voice（我的特色）三项已在对话中集齐；回复时可引用，不必再追问填表。";
  }
  const missing = missingVoiceKeys(work.featureCore);
  const next = missing[0];
  const field = FEATURE_CORE_FIELDS.find((f) => f.key === next);
  const lines = [
    "Voice 必须通过对话收集，禁止让用户去侧栏或表单填写。",
    `当前缺：${missing.map((k) => FEATURE_CORE_FIELDS.find((f) => f.key === k)?.key).join("、")}`,
    "每次最多追问 1 个 Voice 问题，语气口语、简短。",
    field ? `本轮优先问：${field.label}` : "",
    "从用户回答中提炼后，在回复末尾附一行（有则写，无则省略）：",
    "Voice·who：… / Voice·remember：… / Voice·avoid：…（只写本轮新确认项）"
  ].filter(Boolean);
  return lines.join("\n");
}

const VOICE_LINE_RE =
  /Voice\s*[·•]\s*(who|remember|avoid)\s*[：:]\s*([^\n]+)/gi;

function parseVoiceLines(text: string): Partial<FeatureCore> {
  const out: Partial<FeatureCore> = {};
  let m: RegExpExecArray | null;
  const re = new RegExp(VOICE_LINE_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const key = m[1] as FeatureCoreKey;
    const val = m[2].trim().slice(0, 200);
    if (val) out[key] = val;
  }
  return out;
}

/** 助手刚问了 Voice 某一项时，用下一条用户回复填充 */
function inferFromQuestionAnswerPair(turns: StudioAgentTurn[], core: FeatureCore): Partial<FeatureCore> {
  const out: Partial<FeatureCore> = {};
  const missing = new Set(missingVoiceKeys(core));

  for (let i = 0; i < turns.length - 1; i++) {
    const a = turns[i];
    const u = turns[i + 1];
    if (a.role !== "assistant" || u.role !== "user" || u.streaming) continue;
    const reply = u.content.trim();
    if (reply.length < 4 || reply.length > 240) continue;
    const at = a.content;

    if (missing.has("who") && !out.who && /你是谁|写给谁|受众|读者是谁/.test(at)) {
      out.who = reply;
      missing.delete("who");
    }
    if (missing.has("remember") && !out.remember && /印象|记住|记住什么|留下什么/.test(at)) {
      out.remember = reply;
      missing.delete("remember");
    }
    if (missing.has("avoid") && !out.avoid && /不要|底线|雷区|避免|禁忌/.test(at)) {
      out.avoid = reply;
      missing.delete("avoid");
    }
  }
  return out;
}

export function extractFeatureCoreFromDialog(
  work: StudioWork,
  turns: StudioAgentTurn[]
): FeatureCore {
  const base = { ...EMPTY_FEATURE_CORE, ...work.featureCore };
  const texts = turns
    .filter((t) => !t.streaming && t.content.trim())
    .map((t) => t.content)
    .join("\n");

  const fromLines = parseVoiceLines(texts);
  const fromPairs = inferFromQuestionAnswerPair(turns, base);

  const next = { ...base };
  for (const key of ["who", "remember", "avoid"] as const) {
    const v = fromLines[key] || fromPairs[key];
    if (v?.trim() && !next[key].trim()) next[key] = v.trim();
  }
  return next;
}

export function mergeVoiceIntoWork(work: StudioWork, turns: StudioAgentTurn[]): StudioWork | null {
  const nextCore = extractFeatureCoreFromDialog(work, turns);
  const changed =
    nextCore.who !== work.featureCore.who ||
    nextCore.remember !== work.featureCore.remember ||
    nextCore.avoid !== work.featureCore.avoid;
  if (!changed) return null;
  return { ...work, featureCore: nextCore };
}
