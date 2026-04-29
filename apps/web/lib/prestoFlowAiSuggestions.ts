import type { ClipSilenceSegment, ClipWord } from "./clipTypes";
import {
  buildPhraseExemptWordIdSet,
  ROUGH_CUT_FILLER_PHRASES as FILLER_CORE,
  ROUGH_CUT_HESITATION_TOKENS as HESITATION_CORE
} from "./prestoFlowRoughCutLexicon";
import { buildFlowUnits, displayToken } from "./prestoFlowTranscript";

/** 可执行的建议动作（由侧栏「执行」触发） */
export type ClipSuggestionExecute =
  | { kind: "keepStutterFirst"; wordIds: string[] }
  | { kind: "excludeWords"; wordIds: string[] }
  | { kind: "startExport" };

/** 两阶段 LLM：意向条目的展开参数 */
export type ClipOutlineSource = {
  suggestionId: string;
  title: string;
  body: string;
};

export type ClipEditSuggestion = {
  id: string;
  title: string;
  body: string;
  wordId?: string;
  /** 规则 / DeepSeek 等 */
  source?: "rule" | "llm";
  execute?: ClipSuggestionExecute;
  executeLabel?: string;
  /** 阶段一意向：无 execute，侧栏「展开」走 expand */
  outlineSource?: ClipOutlineSource;
  /** 编排器下发的 suggestion_id（反馈用） */
  llmSuggestionId?: string;
  parentLlmSuggestionId?: string;
  phase?: 1 | 2;
};

/** 编排器 POST edit-suggestions 返回项（结构化 DeepSeek） */
export type LlmSuggestionApiItem = {
  title: string;
  body: string;
  action?: string;
  word_ids?: string[];
  wordIds?: string[];
  suggestion_id?: string;
  phase?: number | string;
  parent_suggestion_id?: string;
};

function wordCore(w: ClipWord): string {
  return displayToken(w).replace(/[，,。.!！?？、；;:""''「」…]+$/u, "").trim();
}

/** 纯拉丁词统一小写，便于与填充词表匹配（ASR 大小写不一） */
function lexNormKey(c: string): string {
  if (!c) return c;
  if (/[A-Za-z]/.test(c) && !/[\u4e00-\u9fff]/.test(c)) return c.toLowerCase();
  return c;
}

/**
 * 规则型剪辑建议：叠字、高频填充词、极短碎片、已剪提示；无远端模型。
 */
export function buildClipEditSuggestions(
  words: readonly ClipWord[],
  excluded: ReadonlySet<string>,
  exemptCores?: ReadonlySet<string>
): ClipEditSuggestion[] {
  const out: ClipEditSuggestion[] = [];
  const units = buildFlowUnits(words);
  const exm = exemptCores;
  const phraseExemptWordIds = buildPhraseExemptWordIdSet(words, exm);

  let stutterN = 0;
  for (const u of units) {
    if (u.kind !== "stutter" || u.words.length < 2) continue;
    const first = u.words[0]!;
    const firstCore = lexNormKey(wordCore(first));
    if (exm?.size && firstCore && exm.has(firstCore)) continue;
    if (excluded.size && u.words.every((w) => excluded.has(w.id))) continue;
    if (stutterN >= 8) break;
    stutterN += 1;
    const ids = u.words.map((w) => w.id);
    out.push({
      id: `stutter-${first.id}`,
      title: "口癖 / 叠字",
      body: `连续「${displayToken(first)}」×${u.words.length}，可保留首词其余剪掉。`,
      wordId: first.id,
      source: "rule",
      execute: { kind: "keepStutterFirst", wordIds: ids },
      executeLabel: "仅保留首词"
    });
  }

  const durByCore = new Map<string, { count: number; ids: string[] }>();
  for (const w of words) {
    const c = lexNormKey(wordCore(w));
    if (c.length < 2) continue;
    const prev = durByCore.get(c);
    if (!prev) durByCore.set(c, { count: 1, ids: [w.id] });
    else {
      prev.count += 1;
      if (prev.ids.length < 200) prev.ids.push(w.id);
    }
  }

  for (const [core, { count, ids }] of durByCore) {
    if (exm?.size && exm.has(core)) continue;
    if (!FILLER_CORE.has(core) || count < 3 || ids.length === 0) continue;
    const sample = ids[0]!;
    const notExcluded = ids.filter((id) => !excluded.has(id) && !phraseExemptWordIds.has(id));
    if (notExcluded.length === 0) continue;
    out.push({
      id: `filler-${sample}`,
      title: "高频填充词",
      body: `「${core}」出现约 ${count} 次，可一键剪掉当前稿面中尚未标记删除的实例。`,
      wordId: sample,
      source: "rule",
      execute: { kind: "excludeWords", wordIds: notExcluded },
      executeLabel: "剪掉全部该词"
    });
  }

  const hesIds: string[] = [];
  const hesByCore = new Map<string, number>();
  for (const w of words) {
    if (phraseExemptWordIds.has(w.id)) continue;
    const c = lexNormKey(wordCore(w));
    if (exm?.size && exm.has(c)) continue;
    if (!HESITATION_CORE.has(c)) continue;
    if (excluded.has(w.id)) continue;
    if (w.e_ms - w.s_ms > 420) continue;
    hesByCore.set(c, (hesByCore.get(c) ?? 0) + 1);
    if (hesIds.length < 80) hesIds.push(w.id);
  }
  let hesTotal = 0;
  for (const n of hesByCore.values()) hesTotal += n;
  if (hesTotal >= 5 && hesIds.length > 0) {
    const sample = hesIds[0]!;
    out.push({
      id: `hes-${sample}`,
      title: "语气词 / 气口",
      body: `检出 ${hesTotal} 处较短语气词（如「嗯」「啊」等），多为可删气口；可一键剪掉下列尚未标记删除的实例（仍可用撤销恢复）。`,
      wordId: sample,
      source: "rule",
      execute: { kind: "excludeWords", wordIds: hesIds },
      executeLabel: "剪掉检出的语气词"
    });
  }

  let veryShort = 0;
  const shortIds: string[] = [];
  for (const w of words) {
    if (w.e_ms - w.s_ms >= 45) continue;
    if (!wordCore(w)) continue;
    veryShort += 1;
    if (shortIds.length < 40 && !excluded.has(w.id)) shortIds.push(w.id);
  }
  if (veryShort >= 6 && shortIds.length > 0) {
    const sample = shortIds[0]!;
    out.push({
      id: `short-${sample}`,
      title: "极短碎片",
      body: `检出 ${veryShort} 处不足 45ms 的极短词，可批量剪掉前 ${shortIds.length} 处（谨慎）。`,
      wordId: sample,
      source: "rule",
      execute: { kind: "excludeWords", wordIds: shortIds },
      executeLabel: "剪掉一批极短词"
    });
  }

  if (excluded.size > 0) {
    out.unshift({
      id: "export-preview",
      title: "导出成片",
      body: `已标记剪掉 ${excluded.size} 个词块；试听会跳过剪掉片段，导出将按保留内容合并。`,
      source: "rule",
      execute: { kind: "startExport" },
      executeLabel: "提交导出"
    });
  }

  return out.slice(0, 16);
}

/**
 * 粗剪侧栏：合并「相同」的规则建议（如多条叠字口癖指向同一词核），避免列表重复。
 */
export function dedupeRoughCutEditSuggestions(
  suggestions: readonly ClipEditSuggestion[],
  words: readonly ClipWord[]
): ClipEditSuggestion[] {
  const seen = new Set<string>();
  const out: ClipEditSuggestion[] = [];
  for (const s of suggestions) {
    const ex = s.execute;
    let key: string;
    if (ex?.kind === "keepStutterFirst" && ex.wordIds.length) {
      const w0 = words.find((x) => x.id === ex.wordIds[0]);
      const core = w0 ? lexNormKey(wordCore(w0)) : "";
      key = `stutter:${core}`;
    } else if (ex?.kind === "excludeWords" && ex.wordIds.length) {
      const sig = [...ex.wordIds].sort().join("\0");
      key = `exclude:${s.title}\0${sig}`;
    } else {
      key = `id:${s.id}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const LONG_SILENCE_MS = 1000;
const SILENCE_WORD_MAX_MS = 400;
const SILENCE_WORD_CAP = 20;

/**
 * 在长静音段内找「短词」中点，生成一条可执行的批量剪掉建议。
 */
export function buildSilenceWordSuggestions(
  words: readonly ClipWord[],
  segments: readonly ClipSilenceSegment[] | null | undefined,
  excluded: ReadonlySet<string>
): ClipEditSuggestion[] {
  if (!segments?.length) return [];
  const longSegs = segments.filter((s) => {
    const a = Number(s.start_ms);
    const b = Number(s.end_ms);
    return Number.isFinite(a) && Number.isFinite(b) && b - a >= LONG_SILENCE_MS;
  });
  if (!longSegs.length) return [];
  const picked: string[] = [];
  for (const seg of longSegs) {
    const sm = Number(seg.start_ms);
    const em = Number(seg.end_ms);
    for (const w of words) {
      if (picked.length >= SILENCE_WORD_CAP) break;
      if (excluded.has(w.id)) continue;
      const mid = (w.s_ms + w.e_ms) / 2;
      const wd = w.e_ms - w.s_ms;
      if (mid >= sm && mid <= em && wd > 0 && wd <= SILENCE_WORD_MAX_MS) picked.push(w.id);
    }
    if (picked.length >= SILENCE_WORD_CAP) break;
  }
  const uniq = [...new Set(picked)];
  if (!uniq.length) return [];
  const sample = uniq[0]!;
  return [
    {
      id: `silence-${longSegs[0]!.start_ms}-${longSegs[0]!.end_ms}`,
      title: "长静音内的短词",
      body: `检出 ${longSegs.length} 处长静音（≥${LONG_SILENCE_MS / 1000}s），其中共 ${uniq.length} 个短词块（≤${SILENCE_WORD_MAX_MS}ms）落在静音内，多为气口碎片；可一键剪掉下列词（仍可用撤销恢复）。`,
      wordId: sample,
      source: "rule",
      execute: { kind: "excludeWords", wordIds: uniq.slice(0, SILENCE_WORD_CAP) },
      executeLabel: "剪掉静音内短词"
    }
  ];
}

function collectWordIds(it: LlmSuggestionApiItem): string[] {
  const a = it.word_ids;
  const b = it.wordIds;
  const raw = Array.isArray(a) ? a : Array.isArray(b) ? b : [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function parsePhase(it: LlmSuggestionApiItem): 1 | 2 | undefined {
  const p = it.phase;
  if (p === 1 || p === "1") return 1;
  if (p === 2 || p === "2") return 2;
  return undefined;
}

/**
 * 将编排器返回的结构化 LLM 项映射为侧栏建议（含可执行动作）。
 */
export function mapLlmApiItemsToSuggestions(items: readonly LlmSuggestionApiItem[]): ClipEditSuggestion[] {
  return items.map((it, i) => {
    const slug = it.title.replace(/\s+/g, "-").slice(0, 24);
    const sid = String(it.suggestion_id || "").trim();
    const parent = String(it.parent_suggestion_id || "").trim();
    const phase = parsePhase(it);
    const stableId = sid ? `llm-${sid}` : `llm-${i}-${slug}`;
    const base: ClipEditSuggestion = {
      id: stableId,
      title: it.title,
      body: it.body,
      source: "llm",
      llmSuggestionId: sid || undefined,
      parentLlmSuggestionId: parent || undefined,
      phase: phase ?? 2
    };
    if (phase === 1 && sid) {
      return {
        ...base,
        outlineSource: { suggestionId: sid, title: it.title, body: it.body },
        phase: 1
      };
    }
    const act = (it.action || "none").toLowerCase();
    const wids = collectWordIds(it).slice(0, 32);
    if (act === "exclude_word_ids" && wids.length > 0) {
      return {
        ...base,
        wordId: wids[0],
        execute: { kind: "excludeWords", wordIds: wids },
        executeLabel: "应用删除"
      };
    }
    if (act === "keep_stutter_first" && wids.length >= 2) {
      return {
        ...base,
        wordId: wids[0],
        execute: { kind: "keepStutterFirst", wordIds: wids },
        executeLabel: "仅保留首词"
      };
    }
    return base;
  });
}
