import type { ClipWord } from "./clipTypes";
import { displayToken } from "./prestoFlowTranscript";

/** 常见口癖 / 填充短语（与粗剪建议、规则建议共用） */
export const ROUGH_CUT_FILLER_PHRASES = new Set([
  "那个",
  "这个",
  "就是",
  "然后",
  "所以说",
  "所以说呢",
  "的话",
  "其实",
  "反正",
  "基本上",
  "怎么说呢",
  "你知道",
  "对吧",
  "对不对",
  "是不是",
  "那个啥",
  "怎么说",
  "怎么说来着",
  "怎么说来着啊",
  "well",
  "like",
  "you know",
  "i mean",
  "actually",
  "basically",
  "literally",
  "sort of",
  "kind of"
]);

/** 单字 / 短语气词 */
export const ROUGH_CUT_HESITATION_TOKENS = new Set([
  "嗯",
  "啊",
  "呃",
  "诶",
  "哎",
  "哦",
  "喔",
  "咳",
  "哈",
  "欸",
  "唔",
  "哼",
  "额",
  "em",
  "um",
  "uh",
  "hm",
  "mm",
  "mhm"
]);

function lexNormKey(c: string): string {
  if (!c) return c;
  if (/[A-Za-z]/.test(c) && !/[\u4e00-\u9fff]/.test(c)) return c.toLowerCase();
  return c;
}

function phraseNormKey(c: string): string {
  return lexNormKey(c).replace(/\s+/g, "");
}

/** 工程配置的嘉宾名 / 公司名 / 专业词：整词核命中则不作为口癖 */
export function buildRoughCutExemptSet(phrases: readonly string[] | null | undefined): ReadonlySet<string> {
  const s = new Set<string>();
  if (!Array.isArray(phrases)) return s;
  for (const p of phrases) {
    const k = lexNormKey(String(p || "").trim());
    if (k) s.add(k);
  }
  return s;
}

function wordCore(w: ClipWord): string {
  return displayToken(w).replace(/[，,。.!！?？、；;:""''「」…]+$/u, "").trim();
}

/**
 * 计算“短语豁免”命中的词 id（支持跨多个词的短语，如 "you know"）。
 * 说明：按转写词顺序将词核拼接后做短语匹配，命中区间覆盖到的词均视为豁免。
 */
export function buildPhraseExemptWordIdSet(
  words: readonly ClipWord[],
  exemptCores?: ReadonlySet<string>
): ReadonlySet<string> {
  if (!exemptCores?.size || !words.length) return new Set<string>();
  const tokens: Array<{ id: string; core: string }> = [];
  for (const w of words) {
    const core = phraseNormKey(wordCore(w));
    if (!core) continue;
    tokens.push({ id: w.id, core });
  }
  if (!tokens.length) return new Set<string>();

  const joined = tokens.map((t) => t.core).join("");
  if (!joined) return new Set<string>();

  const offsets: number[] = [];
  let pos = 0;
  for (const t of tokens) {
    offsets.push(pos);
    pos += t.core.length;
  }

  const hitIds = new Set<string>();
  for (const phrase of exemptCores) {
    const needle = phraseNormKey(String(phrase || "").trim());
    if (!needle) continue;
    let seekFrom = 0;
    while (seekFrom <= joined.length - needle.length) {
      const idx = joined.indexOf(needle, seekFrom);
      if (idx < 0) break;
      const end = idx + needle.length;
      for (let i = 0; i < tokens.length; i += 1) {
        const s = offsets[i]!;
        const e = s + tokens[i]!.core.length;
        if (e > idx && s < end) hitIds.add(tokens[i]!.id);
      }
      seekFrom = idx + Math.max(1, needle.length);
    }
  }
  return hitIds;
}

/** 词核是否命中口癖表（整词匹配短语或单字语气词） */
export function wordIsVerbalTic(w: ClipWord, exemptCores?: ReadonlySet<string>): boolean {
  const core = lexNormKey(wordCore(w));
  if (!core) return false;
  if (exemptCores?.size && exemptCores.has(core)) return false;
  if (ROUGH_CUT_HESITATION_TOKENS.has(core)) return true;
  if (ROUGH_CUT_FILLER_PHRASES.has(core)) return true;
  return false;
}

/** 与侧栏口癖行 `tic:${coreKey}` 一致，用于「隐藏本行」后取消稿面口癖高亮 */
export function verbalTicRowDismissId(w: ClipWord, exemptCores?: ReadonlySet<string>): string | null {
  if (!wordIsVerbalTic(w, exemptCores)) return null;
  const core = lexNormKey(wordCore(w));
  return core ? `tic:${core}` : null;
}

/** 口癖按词核聚合后的展示摘要（用于侧栏列出「具体是哪些口癖」） */
export type VerbalTicHitSummary = {
  /** 与豁免表、词核比对用的规范化 key */
  coreKey: string;
  label: string;
  count: number;
  sampleWordId: string;
};

/**
 * 按词核聚合口癖命中，按出现次数降序；label 取该核下较短的一条 display，便于阅读。
 */
/** 口癖按词核聚合：区分仍保留的词与已剪掉的词，便于侧栏切换恢复 */
export type VerbalTicAggRow = {
  coreKey: string;
  label: string;
  activeIds: string[];
  excludedIds: string[];
};

export function aggregateVerbalTicRows(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  exemptCores?: ReadonlySet<string>,
  maxKinds = 20
): VerbalTicAggRow[] {
  const phraseExemptWordIds = buildPhraseExemptWordIdSet(words, exemptCores);
  const byKey = new Map<string, { activeIds: string[]; excludedIds: string[]; label: string }>();
  for (const w of words) {
    if (phraseExemptWordIds.has(w.id)) continue;
    if (!wordIsVerbalTic(w, exemptCores)) continue;
    const core = lexNormKey(wordCore(w));
    if (!core) continue;
    const disp = displayToken(w).trim() || core;
    const prev = byKey.get(core);
    if (!prev) {
      byKey.set(core, {
        activeIds: [],
        excludedIds: [],
        label: disp
      });
    }
    const row = byKey.get(core)!;
    if (disp.length > 0 && disp.length < row.label.length) row.label = disp;
    if (excluded.has(w.id)) row.excludedIds.push(w.id);
    else row.activeIds.push(w.id);
  }
  return [...byKey.entries()]
    .map(([coreKey, v]) => ({
      coreKey,
      label: v.label,
      activeIds: v.activeIds,
      excludedIds: v.excludedIds
    }))
    .sort((a, b) => b.activeIds.length + b.excludedIds.length - (a.activeIds.length + a.excludedIds.length))
    .slice(0, maxKinds);
}

export function summarizeVerbalTicHits(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  exemptCores?: ReadonlySet<string>,
  maxKinds = 14
): VerbalTicHitSummary[] {
  const phraseExemptWordIds = buildPhraseExemptWordIdSet(words, exemptCores);
  const byKey = new Map<string, { count: number; sampleWordId: string; label: string; coreKey: string }>();
  for (const w of words) {
    if (phraseExemptWordIds.has(w.id)) continue;
    if (excluded.has(w.id)) continue;
    if (!wordIsVerbalTic(w, exemptCores)) continue;
    const core = lexNormKey(wordCore(w));
    if (!core) continue;
    const disp = displayToken(w).trim() || core;
    const prev = byKey.get(core);
    if (!prev) {
      byKey.set(core, { count: 1, sampleWordId: w.id, label: disp, coreKey: core });
    } else {
      prev.count += 1;
      if (disp.length > 0 && disp.length < prev.label.length) prev.label = disp;
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, maxKinds)
    .map(({ label, count, sampleWordId, coreKey }) => ({ coreKey, label, count, sampleWordId }));
}

/** 剪掉某一词核下全部尚未删除的口癖命中 */
export function collectVerbalTicWordIdsForCore(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  exemptCores: ReadonlySet<string> | undefined,
  coreKey: string
): string[] {
  const phraseExemptWordIds = buildPhraseExemptWordIdSet(words, exemptCores);
  const want = lexNormKey(String(coreKey || "").trim());
  if (!want) return [];
  const out: string[] = [];
  for (const w of words) {
    if (phraseExemptWordIds.has(w.id)) continue;
    if (excluded.has(w.id)) continue;
    if (!wordIsVerbalTic(w, exemptCores)) continue;
    if (lexNormKey(wordCore(w)) === want) out.push(w.id);
  }
  return out;
}

export function collectVerbalTicWordIds(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  exemptCores?: ReadonlySet<string>
): string[] {
  const phraseExemptWordIds = buildPhraseExemptWordIdSet(words, exemptCores);
  const out: string[] = [];
  for (const w of words) {
    if (phraseExemptWordIds.has(w.id)) continue;
    if (excluded.has(w.id)) continue;
    if (wordIsVerbalTic(w, exemptCores)) out.push(w.id);
  }
  return out;
}

export function collectSubstringMatchWordIds(
  words: readonly ClipWord[],
  query: string,
  excluded: ReadonlySet<string>
): string[] {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();
  const out: string[] = [];
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    const disp = displayToken(w);
    if (!disp) continue;
    const hay = /[a-z]/i.test(q) && !/[\u4e00-\u9fff]/.test(q) ? disp.toLowerCase() : disp;
    const needle = /[a-z]/i.test(q) && !/[\u4e00-\u9fff]/.test(q) ? qLower : q;
    if (hay.includes(needle)) out.push(w.id);
  }
  if (out.length > 0) return out;
  // Fallback: support multi-word phrase queries by matching against joined transcript text.
  // 计数按“短语出现次数”而非“命中的字数/词数”。
  const tokens: Array<{ id: string; text: string }> = [];
  for (const w of words) {
    if (excluded.has(w.id)) continue;
    const disp = displayToken(w);
    if (!disp) continue;
    tokens.push({ id: w.id, text: disp });
  }
  if (!tokens.length) return out;
  const latin = /[a-z]/i.test(q) && !/[\u4e00-\u9fff]/.test(q);
  const needleJoined = latin ? qLower : q;
  const joined = (latin ? tokens.map((t) => t.text.toLowerCase()) : tokens.map((t) => t.text)).join("");
  const matchedOccurrenceAnchorIds: string[] = [];
  let seekFrom = 0;
  while (seekFrom <= joined.length - needleJoined.length) {
    const idx = joined.indexOf(needleJoined, seekFrom);
    if (idx < 0) break;
    let pos = 0;
    let anchorId: string | null = null;
    for (const t of tokens) {
      const end = pos + t.text.length;
      if (end > idx && pos <= idx) {
        anchorId = t.id;
        break;
      }
      pos = end;
    }
    if (anchorId) matchedOccurrenceAnchorIds.push(anchorId);
    // 前进到本次命中的末尾，避免同一短语内部被重复计数
    seekFrom = idx + Math.max(1, needleJoined.length);
  }
  return matchedOccurrenceAnchorIds;
}
