import type { ClipWord } from "./clipTypes";

/** 与 ASR 词块对齐的展示 token（含标点） */
export function displayToken(w: ClipWord): string {
  return `${w.text}${w.punct ?? ""}`;
}

/** 去掉尾部标点，用于叠词/叠音与词表比对 */
export function coreTokenForRedup(token: string): string {
  return token.replace(/[，,。.!！?？、；;:""''「」…]+$/u, "").trim();
}

/** 常见合法汉语叠词 / 口语重复，不作为口吃叠音提示 */
const LEGITIMATE_REDUP_CORE = new Set(
  [
    "好好",
    "等等",
    "对对",
    "是是",
    "嗯嗯",
    "喔喔",
    "哦哦",
    "哈哈",
    "嘿嘿",
    "呵呵",
    "慢慢",
    "看看",
    "想想",
    "试试",
    "走走",
    "说说",
    "笑笑",
    "谢谢",
    "拉拉",
    "买买买",
    "天天",
    "人人",
    "处处",
    "年年",
    "家家",
    "宝宝",
    "拜拜",
    "谢谢谢",
    "行行",
    "对对对",
    "好好好",
    "是是是",
    "嗯嗯嗯",
    "对对对对",
    "哈哈哈哈",
    "常常",
    "刚刚",
    "渐渐",
    "悄悄",
    "牢牢",
    "紧紧",
    "轻轻",
    "默默",
    "微微",
    "淡淡",
    "深深",
    "纷纷",
    "连连",
    "频频",
    "恰恰",
    "偏偏",
    "明明",
    "整整",
    "统统",
    "匆匆",
    "徐徐",
    "空空",
    "荡荡",
    "往往",
    "早早",
    "远远",
    "高高",
    "长长",
    "短短",
    "细细",
    "满满",
    "方方",
    "圆圆",
    "麻麻",
    "辣辣",
    "香香",
    "乖乖",
    "娃娃",
    "汪汪",
    "咪咪",
    "嗡嗡",
    "滚滚",
    "阵阵",
    "片片",
    "条条",
    "根根",
    "点点",
    "滴滴",
    "多多少少",
    "反反复复",
    "断断续续",
    "明明白白",
    "实实在在",
    "清清楚楚",
    "整整齐齐",
    "高高兴兴",
    "快快乐乐",
    "简简单单",
    "认认真真",
    "仔仔细细",
    "大大小小",
    "老老少少",
    "里里外外",
    "上上下下",
    "前前后后",
    "左左右右"
]);

/** 相邻同词块间隔超过此值则不再合并为叠字组（减少跨句正常重复误判） */
const STUTTER_JOIN_MAX_GAP_MS = 260;

function isLegitimateReduplication(displayKey: string): boolean {
  const core = coreTokenForRedup(displayKey);
  if (!core) return false;
  if (LEGITIMATE_REDUP_CORE.has(core)) return true;
  return false;
}

export type FlowUnit =
  | { kind: "single"; word: ClipWord }
  | { kind: "stutter"; words: ClipWord[] };

/**
 * 叠音：连续、displayToken 完全相同的词块合并为 stutter；
 * 符合常见叠词用法的合并为多个 single，不提示口吃。
 */
export function buildFlowUnits(words: readonly ClipWord[]): FlowUnit[] {
  const out: FlowUnit[] = [];
  let i = 0;
  while (i < words.length) {
    const w0 = words[i]!;
    const key = displayToken(w0);
    if (!key.trim()) {
      out.push({ kind: "single", word: w0 });
      i += 1;
      continue;
    }
    const run: ClipWord[] = [w0];
    let j = i + 1;
    while (j < words.length && displayToken(words[j]!) === key) {
      const last = run[run.length - 1]!;
      const cand = words[j]!;
      if (cand.s_ms - last.e_ms > STUTTER_JOIN_MAX_GAP_MS) break;
      run.push(cand);
      j += 1;
    }
    if (run.length >= 2 && !isLegitimateReduplication(key)) {
      out.push({ kind: "stutter", words: run });
    } else {
      for (const w of run) out.push({ kind: "single", word: w });
    }
    i = j;
  }
  return out;
}

export type SpeakerLine = { speaker: number; units: FlowUnit[] };

/** 一行稿面内全部词 id（含口吃组内多词），用于「整句」多选 */
export function collectLineWordIds(line: SpeakerLine): string[] {
  const out: string[] = [];
  for (const u of line.units) {
    if (u.kind === "single") out.push(u.word.id);
    else for (const w of u.words) out.push(w.id);
  }
  return out;
}

/** 按转写顺序排列词 id（用于口癖行「下一次点击跳下一处」） */
export function orderWordIdsByTranscript(ids: readonly string[], orderedWords: readonly ClipWord[]): string[] {
  const pos = new Map(orderedWords.map((w, i) => [w.id, i] as const));
  return [...ids].filter((id) => pos.has(id)).sort((a, b) => (pos.get(a)! - pos.get(b)!));
}

/** 词所在稿面行的最后一个词的结束时间（毫秒），用于试听播放到句末暂停 */
export function maxEndMsForLineContainingWordId(
  lines: readonly SpeakerLine[],
  wordId: string,
  words: readonly ClipWord[]
): number | null {
  for (const line of lines) {
    const ids = collectLineWordIds(line);
    if (!ids.includes(wordId)) continue;
    let maxE = 0;
    for (const id of ids) {
      const w = words.find((x) => x.id === id);
      if (w && Number.isFinite(w.e_ms) && w.e_ms > maxE) maxE = w.e_ms;
    }
    return maxE > 0 ? maxE : null;
  }
  return null;
}

/** 在已排序词表中取两端 id 之间的闭区间 id（含端点） */
export function wordIdsBetweenInclusive(
  orderedWords: readonly ClipWord[],
  aId: string,
  bId: string
): string[] {
  const ia = orderedWords.findIndex((w) => w.id === aId);
  const ib = orderedWords.findIndex((w) => w.id === bId);
  if (ia < 0 || ib < 0) return [];
  const lo = Math.min(ia, ib);
  const hi = Math.max(ia, ib);
  return orderedWords.slice(lo, hi + 1).map((w) => w.id);
}

function speakerOfUnit(u: FlowUnit): number {
  return u.kind === "single" ? u.word.speaker : u.words[0]!.speaker;
}

function lastDisplayToken(u: FlowUnit): string {
  return u.kind === "single" ? displayToken(u.word) : displayToken(u.words[u.words.length - 1]!);
}

/** 句末标点：该词所在 display 以句终符结尾则换行 */
function endsSentenceBoundary(display: string): boolean {
  const t = display.trim();
  if (!t) return false;
  return /[。！？.!?…]["」』）)]*$/u.test(t);
}

function flowUnitCharLength(u: FlowUnit): number {
  return u.kind === "single"
    ? displayToken(u.word).length
    : u.words.reduce((acc, w) => acc + displayToken(w).length, 0);
}

function firstWordOfUnit(u: FlowUnit): ClipWord {
  return u.kind === "single" ? u.word : u.words[0]!;
}

function lastWordOfUnit(u: FlowUnit): ClipWord {
  return u.kind === "single" ? u.word : u.words[u.words.length - 1]!;
}

function firstWordStartMs(u: FlowUnit): number {
  return firstWordOfUnit(u).s_ms;
}

function lastWordEndMs(u: FlowUnit): number {
  return lastWordOfUnit(u).e_ms;
}

function utteranceStartsAtUnit(u: FlowUnit): boolean {
  return Boolean(firstWordOfUnit(u).utt_new);
}

/**
 * 单行展示字符上限（displayToken 拼接长度），超过则强制换行，避免稿面横向过长。
 * 仅作版式兜底，不替代火山 utterance 语义/VAD 分句。
 */
const MAX_LINE_DISPLAY_CHARS = 48;

/** 同一 utterance 内相邻词块间隔超过此值则强制换行，缓解 ASR 未切分的长停顿句 */
const LONG_INTRA_UTT_GAP_MS = 780;

/** 行已较长时允许在逗号、顿号处换行，减轻「一整行过长」的阅读负担 */
const MIN_LINE_CHARS_BEFORE_COMMA_BREAK = 30;

function clauseCommaEndsUnit(display: string): boolean {
  const t = display.trim();
  if (!t) return false;
  return /[，,、]$/u.test(t);
}

/**
 * 稿面换行优先对齐火山 ASR 的 utterance 边界（normalize 写入的 utt_new）：
 * 说话人切换、新 utterance 首词、句末标点；辅以长停顿断行与适度逗顿换行以改善可读性。
 */
export function groupSpeakerSentenceLines(units: readonly FlowUnit[]): SpeakerLine[] {
  const lines: SpeakerLine[] = [];
  let cur: SpeakerLine | null = null;
  let curCharLen = 0;

  const flush = () => {
    if (cur) {
      lines.push(cur);
      cur = null;
    }
    curCharLen = 0;
  };

  for (const u of units) {
    const sp = speakerOfUnit(u);
    if (cur && cur.speaker !== sp) {
      flush();
    } else if (cur && utteranceStartsAtUnit(u)) {
      flush();
    } else if (cur && cur.units.length > 0) {
      const lastU = cur.units[cur.units.length - 1]!;
      if (firstWordStartMs(u) - lastWordEndMs(lastU) > LONG_INTRA_UTT_GAP_MS) {
        flush();
      }
    }
    if (!cur) {
      cur = { speaker: sp, units: [u] };
      curCharLen = flowUnitCharLength(u);
    } else {
      cur.units.push(u);
      curCharLen += flowUnitCharLength(u);
    }
    const tail = lastDisplayToken(u);
    if (endsSentenceBoundary(tail)) {
      flush();
    } else if (cur && curCharLen >= MAX_LINE_DISPLAY_CHARS) {
      flush();
    } else if (cur && curCharLen >= MIN_LINE_CHARS_BEFORE_COMMA_BREAK && clauseCommaEndsUnit(tail)) {
      flush();
    }
  }
  flush();
  return lines;
}
