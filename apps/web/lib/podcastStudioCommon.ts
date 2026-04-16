import type { VoiceOpt } from "../components/studio/VoiceSelect";
import { PODCAST_DEFAULT_VOICE_ID_FALLBACK, PODCAST_PRESET_VOICES } from "./podcastVoiceDefaults";

export const DEFAULT_SCRIPT_CONSTRAINTS =
  "对话内容中不能包含（笑）（停顿）（思考）等动作、心理活动或场景描述，只生成纯对话文本。";

export const DURATION_PRESETS = [
  { label: "短", hint: "约 3–4 分钟", chars: 800 },
  { label: "中", hint: "约 7–9 分钟", chars: 2000 },
  { label: "长", hint: "约 15–18 分钟", chars: 4500 }
] as const;

/**
 * 精确字数输入是否与已提交字数一致。编辑过程中若与预设字数不一致，不应高亮「短/中/长」。
 */
export function durationInputMatchesCommitted(committedChars: number, inputValue: string): boolean {
  const t = inputValue.trim();
  if (t === "") return false;
  const parsed = Number(t);
  if (!Number.isFinite(parsed)) return false;
  return Math.round(parsed) === committedChars;
}

/**
 * 提交播客任务时采用的目标字数：输入框为合法数字时以其为准（200–9999），否则沿用已提交状态。
 * 避免用户改精确字数后未失焦/回车就点生成，仍把旧字数发给服务端。
 */
export function resolveScriptTargetCharsForJob(committedChars: number, inputValue: string): number {
  const t = inputValue.trim();
  if (t === "") return committedChars;
  const parsed = Number(t);
  if (!Number.isFinite(parsed)) return committedChars;
  return Math.min(9999, Math.max(200, Math.round(parsed)));
}

export const LANG_OPTIONS = ["中文", "English", "日本語"] as const;

/**
 * 从默认音色 + 系统音色表的 description / language 字段汇总脚本语言选项（随音色表更新而扩展）。
 */
export function collectScriptLanguageOptionsFromVoices(
  mergedDefaultVoices: Record<string, Record<string, unknown>>,
  systemVoicesMap: Record<string, Record<string, unknown>> | null | undefined
): string[] {
  const out: string[] = [...LANG_OPTIONS];
  const seen = new Set(out);
  const add = (lang: string) => {
    const t = lang.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  const fromDesc = (desc: string) => {
    const head = (desc.split("·")[0] || desc).trim();
    if (/日本|日語|日文/.test(head) || /日本|日語|日文/.test(desc)) add("日本語");
    else if (/english|英文/i.test(head) || /english|英文/i.test(desc)) add("English");
    else if (/中文|汉语|普通话|国语|简体|繁体/.test(head) || /中文|汉语|普通话/.test(desc)) add("中文");
  };
  const fromEntry = (entry: Record<string, unknown>) => {
    const explicit = String(entry.language ?? entry.script_language ?? "").trim();
    if (explicit) {
      add(explicit);
      return;
    }
    const desc = String(entry.description ?? "").trim();
    if (desc) fromDesc(desc);
  };
  for (const v of Object.values(mergedDefaultVoices || {})) {
    if (v && typeof v === "object") fromEntry(v as Record<string, unknown>);
  }
  for (const v of Object.values(systemVoicesMap || {})) {
    if (v && typeof v === "object") fromEntry(v as Record<string, unknown>);
  }
  return out;
}

/**
 * 加入创意工具栏芯片上的脚本风格摘要（用户自由填写时长句时截断）。
 */
export function formatScriptStyleChip(scriptStyle: string, maxChars = 14): string {
  const t = scriptStyle.trim().replace(/\s+/g, " ");
  if (!t) return "未填";
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

/** 默认节目名：中性表述，避免脚本里反复出现供应商品牌 */
export const DEFAULT_PROGRAM_NAME = "本期播客";

/** 下拉中「克隆 / 系统」后缀，随界面语言传入 */
export type VoiceOptionMarks = {
  cloneMark: string;
  systemMark: string;
};

const DEFAULT_CLONE_MARK = "（克隆）";
const DEFAULT_SYSTEM_MARK = "（系统）";

export function buildVoiceOptionsFromMaps(
  defaultVoicesObj: Record<string, Record<string, unknown>> | null,
  savedList: { voiceId: string; displayName?: string }[],
  systemVoicesObj?: Record<string, Record<string, unknown>> | null,
  marks?: Partial<VoiceOptionMarks> | null
): VoiceOpt[] {
  const cloneMark = (marks?.cloneMark ?? DEFAULT_CLONE_MARK).trim() || DEFAULT_CLONE_MARK;
  const systemMark = (marks?.systemMark ?? DEFAULT_SYSTEM_MARK).trim() || DEFAULT_SYSTEM_MARK;
  const preset = Object.keys(defaultVoicesObj || {})
    .map((k) => {
      const item = defaultVoicesObj![k];
      const vidRaw = item?.voice_id ?? (item as { voiceId?: unknown } | undefined)?.voiceId;
      if (!item || vidRaw === undefined || vidRaw === null || String(vidRaw).trim() === "") return null;
      return {
        key: k,
        voice_id: String(vidRaw).trim(),
        name: String(item.name || k),
        label: `${String(item.name || k)}${item.description ? ` · ${String(item.description)}` : ""}`,
        group: "preset"
      };
    })
    .filter(Boolean) as VoiceOpt[];
  const saved = (savedList || [])
    .map((v) => {
      const vid = String(v.voiceId || "").trim();
      if (!vid) return null;
      return {
        key: `saved:${vid}`,
        voice_id: vid,
        name: v.displayName || vid,
        label: `${v.displayName || vid}${cloneMark}`,
        group: "saved"
      };
    })
    .filter(Boolean) as VoiceOpt[];
  const system = Object.keys(systemVoicesObj || {})
    .map((k) => {
      const item = systemVoicesObj![k];
      const vidRaw = item?.voice_id ?? (item as { voiceId?: unknown } | undefined)?.voiceId;
      if (!item || vidRaw === undefined || vidRaw === null || String(vidRaw).trim() === "") return null;
      return {
        key: k,
        voice_id: String(vidRaw).trim(),
        name: String(item.name || k),
        label: `${String(item.name || k)}${item.description ? ` · ${String(item.description)}` : ""}${systemMark}`,
        group: "system"
      };
    })
    .filter(Boolean) as VoiceOpt[];
  /** 默认音色 > 克隆 > Minimax 系统音色 */
  return [...preset, ...saved, ...system];
}

export function refsFromUrlBlock(block: string): { url?: string; urlListText: string } {
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { urlListText: "" };
  return { url: lines[0], urlListText: lines.slice(1).join("\n") };
}

export function resolveVoiceId(options: VoiceOpt[], key: string): string {
  const o = options.find((x) => x.key === key);
  if (o?.voice_id) {
    const vid = String(o.voice_id).trim();
    if (
      (key === "mini" || key === "max") &&
      vid.startsWith("male-qn-") &&
      typeof PODCAST_PRESET_VOICES[key]?.voice_id === "string"
    ) {
      const want = String(PODCAST_PRESET_VOICES[key]!.voice_id!).trim();
      if (want.startsWith("moss_audio_")) return want;
    }
    return vid;
  }
  const preset = PODCAST_PRESET_VOICES[key]?.voice_id;
  if (typeof preset === "string" && preset.trim()) return preset.trim();
  return PODCAST_DEFAULT_VOICE_ID_FALLBACK;
}

export function buildScriptPayload(
  base: { text: string; url?: string },
  opts: {
    scriptTargetChars: number;
    scriptStyle: string;
    scriptLanguage: string;
    programName: string;
    speaker1Persona: string;
    speaker2Persona: string;
    scriptConstraints: string;
    generateCover?: boolean;
    ref: Record<string, unknown>;
    outputMode: "dialogue" | "article";
    voiceId: string;
    voiceId1: string;
    voiceId2: string;
    introText: string;
    outroText: string;
    /** Max 档：合成前文本模型润色（服务端仍会校验套餐） */
    aiPolish?: boolean;
    ttsExtras?: Record<string, unknown>;
  }
) {
  const constraints = opts.scriptConstraints.trim();
  const out: Record<string, unknown> = {
    ...base,
    script_target_chars: opts.scriptTargetChars,
    script_style: opts.scriptStyle.trim(),
    script_language: opts.scriptLanguage.trim(),
    program_name: opts.programName.trim(),
    speaker1_persona: opts.speaker1Persona.trim(),
    speaker2_persona: opts.speaker2Persona.trim(),
    script_constraints: constraints,
    output_mode: opts.outputMode,
    voice_id: opts.voiceId,
    voice_id_1: opts.voiceId1,
    voice_id_2: opts.voiceId2,
    intro_text: opts.introText.trim(),
    outro_text: opts.outroText.trim(),
    ...opts.ref
  };
  // 播客单人(article)与双人(dialogue)一致：默认生成封面，仅显式 generateCover=false 关闭（script_draft 不走本函数）
  out.generate_cover = opts.generateCover !== false;
  if (opts.aiPolish === true) {
    out.ai_polish = true;
  }
  if (opts.ttsExtras) {
    for (const [k, v] of Object.entries(opts.ttsExtras)) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        out[k] = v;
      }
    }
  }
  return out;
}
