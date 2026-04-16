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
    "哈哈哈哈"
]);

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
      run.push(words[j]!);
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

function firstWordOfUnit(u: FlowUnit): ClipWord {
  return u.kind === "single" ? u.word : u.words[0]!;
}

function lastWordOfUnit(u: FlowUnit): ClipWord {
  return u.kind === "single" ? u.word : u.words[u.words.length - 1]!;
}

/** 相邻词块间静音超过该值（毫秒）视为「下一句」起点（应对无句末标点的 ASR） */
const SENTENCE_GAP_MS = 850;

/** 说话人切换、长停顿或句末标点时换行，一句一行 */
export function groupSpeakerSentenceLines(units: readonly FlowUnit[]): SpeakerLine[] {
  const lines: SpeakerLine[] = [];
  let cur: SpeakerLine | null = null;

  const flush = () => {
    if (cur) {
      lines.push(cur);
      cur = null;
    }
  };

  for (const u of units) {
    const sp = speakerOfUnit(u);
    if (cur && cur.speaker !== sp) {
      flush();
    } else if (cur && cur.units.length > 0) {
      const prevLast = lastWordOfUnit(cur.units[cur.units.length - 1]!);
      const gap = firstWordOfUnit(u).s_ms - prevLast.e_ms;
      if (gap >= SENTENCE_GAP_MS) {
        flush();
      }
    }
    if (!cur) {
      cur = { speaker: sp, units: [u] };
    } else {
      cur.units.push(u);
    }
    if (endsSentenceBoundary(lastDisplayToken(u))) {
      flush();
    }
  }
  flush();
  return lines;
}
