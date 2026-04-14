import { readLocalStorageScoped, removeLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

/**
 * RSS / 小宇宙 等客户端常见映射：
 * - 单集标题 → item.title（列表与详情页主标题）
 * - 节目简介 → item.description / itunes:summary（约 30 字：主线提炼、偏吸引力）
 * - Show Notes → content:encoded（结构化：主题、关键收获、时间轴、金句、资源；勿整篇贴口播稿）
 */

const SUMMARY_SOFT_MAX = 600;

/** 小宇宙/列表卡片常见舒适长度参考（非硬性限制） */
export const SHARE_TITLE_SOFT_MAX = 36;
/** 节目简介（列表摘要）以约 30 字为佳 */
export const SHARE_SUMMARY_IDEAL_MAX = 30;
export const SHARE_SUMMARY_WARN_MAX = 45;

/** 自动生成单集标题目标长度（字） */
export const AUTO_EPISODE_TITLE_TARGET = 10;
export const AUTO_EPISODE_TITLE_MAX = 14;

/** 自动生成节目简介上限（字）：列表卡片摘要，偏短、有吸引力 */
export const AUTO_PROGRAM_SUMMARY_MAX = 30;

const KNOWN_DEFAULT_PROGRAM_NAMES = new Set(["MiniMax AI 播客节目"]);

/** 偏「引发点击」的通俗表述（简介打分加权） */
const CLICK_HOOK_RE = /为什么|如何|怎样|秘诀|价值|干货|必读|值得|颠覆|真相|区别|误区|建议|别错过|一文|盘点|核心/;

/** 行首双人/多轮对白标记（与 TTS Speaker1:/Speaker2: 一致） */
const SPEAKER_LINE_PREFIX_RE = /^\s*(?:Speaker\s*[12]|说话人\s*[12]|S\s*[12])\s*[:：]\s*/i;

/**
 * 去掉单行开头的 Speaker1:/Speaker2: 等标记，保留台词正文。
 */
export function stripSpeakerLinePrefix(line: string): string {
  return String(line || "").replace(SPEAKER_LINE_PREFIX_RE, "").trim();
}

/**
 * 多行口播稿：逐行去标记后拼成一段（用于 preview 摘要等）。
 */
export function stripDialogueMarkersFromBlurb(text: string): string {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const parts = lines.map((l) => stripSpeakerLinePrefix(l)).filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 单集标题：取首条有实质内容的行并去掉 Speaker 前缀（避免列表标题显示 Speaker1: …）。
 */
export function sanitizeShareEpisodeTitle(raw: string, fallback = "未命名单集"): string {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const s = stripSpeakerLinePrefix(line).replace(/\s+/g, " ").trim();
    if (s) return s.slice(0, 300);
  }
  return fallback;
}

/** 从任务 result 取「短摘要」候选：preview / script_preview，并去掉对白行首标记 */
export function defaultSummaryFromJobResult(result: Record<string, unknown>): string {
  const raw = String(result.script_preview || result.preview || "").trim();
  if (!raw) return "";
  const cleaned = stripDialogueMarkersFromBlurb(raw);
  if (!cleaned) return "";
  const oneLine = cleaned.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUMMARY_SOFT_MAX) return oneLine;
  return `${oneLine.slice(0, SUMMARY_SOFT_MAX - 1)}…`;
}

export type ChapterOutlineItem = { title: string; start_ms: number };

/** 章节 → Markdown 时间戳行（与预览/RSS t: 秒 一致） */
export function formatChapterMarkdownLines(chapters: ChapterOutlineItem[]): string[] {
  return chapters.map((c) => {
    const sec = Math.floor((c.start_ms || 0) / 1000);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    const clock = `${mm}:${ss.toString().padStart(2, "0")}`;
    const tit = String(c.title || "章节").replace(/\]/g, "］").replace(/\[/g, "［");
    return `- [${clock} ${tit}](t:${sec})`;
  });
}

/** 从完整文稿取一段作「简介草稿」：去掉对白行首，拼接非空行 */
export function extractSummaryLeadFromScriptText(text: string, maxLen = 320): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const lines = raw.split("\n");
  const parts: string[] = [];
  let acc = 0;
  for (const line of lines) {
    const L = stripSpeakerLinePrefix(line).trim();
    if (!L) continue;
    parts.push(L);
    acc += L.length + 1;
    if (acc >= maxLen * 1.2) break;
  }
  let joined = parts.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length > maxLen) joined = `${joined.slice(0, maxLen - 1)}…`;
  return joined;
}

/** TTS 停顿 / 音效标记，避免进入标题与摘要 */
function stripTtsInlineArtifacts(s: string): string {
  return String(s || "")
    .replace(/<#[\d.]+#>/g, " ")
    .replace(/\([a-z][a-z-]{0,24}\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(flatText: string): string[] {
  const t = stripTtsInlineArtifacts(flatText).replace(/\s+/g, " ").trim();
  if (!t) return [];
  const byEnd = t.split(/(?<=[。！？!?])\s+/).map((x) => x.trim()).filter(Boolean);
  if (byEnd.length >= 2) return byEnd;
  const byComma = t.split(/(?<=[，,])\s+/).map((x) => x.trim()).filter(Boolean);
  if (byComma.length >= 3) return byComma;
  return [t];
}

function truncateSmart(s: string, max: number): string {
  const u = s.trim().replace(/[。！？!?]+$/g, "");
  if (u.length <= max) return u;
  return `${u.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * 任务里用户显式提供的单集/节目标题候选（不含列表展示名）。
 */
export function pickUserProvidedPodcastTitle(payload: Record<string, unknown>, result: Record<string, unknown>): string {
  const ep = String(payload.episode_title || payload.podcast_title || "").trim();
  if (ep) return ep.slice(0, 300);
  const rt = String(result.title || "").trim();
  if (rt) return sanitizeShareEpisodeTitle(rt, "").slice(0, 300);
  const pn = String(payload.program_name || "").trim();
  if (pn && !KNOWN_DEFAULT_PROGRAM_NAMES.has(pn)) return pn.slice(0, 300);
  const first = String(payload.text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return "";
  const fl = first.replace(/^\s*#+\s*/, "").trim();
  if (fl.length >= 2 && fl.length <= 36 && !/^https?:\/\//i.test(fl)) return fl.slice(0, 300);
  return "";
}

/**
 * 无用户标题时：从口播稿 + 素材整体提炼约 10 字短标题（偏中段，减少开场寒暄干扰）。
 */
export function deriveShortTitleFromOverallContent(scriptRaw: string, userSourceText: string): string {
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const b = stripMarkdownishHeaders(userSourceText);
  const merged = stripTtsInlineArtifacts(`${a}\n${b}`.replace(/\s+/g, " ")).trim();
  if (!merged) return "";
  const n = merged.length;
  if (n <= AUTO_EPISODE_TITLE_MAX) return merged;
  const windowStart = Math.floor(n * 0.22);
  const windowText = merged.slice(windowStart, windowStart + Math.min(80, n));
  const sentences = splitIntoSentences(windowText);
  const pick =
    sentences.find((s) => s.length >= AUTO_EPISODE_TITLE_TARGET) ||
    sentences[0] ||
    windowText.replace(/[。！？，,]/g, " ");
  const core = pick.replace(/^[「『【\s]+/, "").trim();
  return truncateSmart(core, AUTO_EPISODE_TITLE_MAX);
}

/** 开场/收尾套话，压低权重 */
const SUMMARY_GREETING_RE =
  /欢迎|大家好|各位好|本期节目|本期我们|咱们今天|感谢收听|感谢各位|下期再见|点赞|订阅|转发|我是主持人|闲话少叙|话不多说/;

/** 更像「信息 / 观点 / 结构」的表述，抬高权重 */
const SUMMARY_SUBSTANCE_RE =
  /核心|关键|要点|重点|本质|原因在于|也就是说|换言之|具体(?:来说|而言)|总结|结论|建议|主要包括|分为|三点|三个层次|第一[，、]|第二[，、]|第三[，、]|一方面|另一方面|最重要的是|值得一提|观点|看法|解读|梳理|对比|案例|数据|研究(?:发现|表明)?|报告|趋势|挑战|机遇|背后|逻辑|机制|原理|方法|步骤|技巧|风险|意义|价值|启发|思考|指出|强调|发现|认为|表示|谈到|提到|围绕|聚焦|聊聊/;

/** 敷衍接话，尽量跳过 */
const SUMMARY_FILLER_ONLY_RE = /^(?:对|是|嗯|好|没错|是吧|对的|嗯嗯|好好){1,6}[。！？…]?$/;

function extractMaterialBigrams(material: string): string[] {
  const s = stripMarkdownishHeaders(material).replace(/[^\u4e00-\u9fff]/g, "").slice(0, 220);
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return [...set].slice(0, 80);
}

/** 素材里较长的中文词，且在口播正文中出现 → 强主题信号 */
function extractTopicPhrasesAnchoredInScript(material: string, scriptFlat: string): string[] {
  const m = stripMarkdownishHeaders(material).slice(0, 600);
  const re = /[\u4e00-\u9fff]{3,12}/g;
  const hits = m.match(re) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of hits) {
    if (seen.has(w) || !scriptFlat.includes(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

function scoreSentenceForSummary(
  raw: string,
  materialBigrams: string[],
  topicPhrases: string[],
  index: number,
  total: number
): number {
  const s = raw.trim();
  if (s.length < 8) return -4;
  if (SUMMARY_FILLER_ONLY_RE.test(s)) return -5;
  let sc = 0;
  if (SUMMARY_GREETING_RE.test(s)) sc -= 2.5;
  if (SUMMARY_SUBSTANCE_RE.test(s)) sc += 2.8;
  if (CLICK_HOOK_RE.test(s)) sc += 1.4;
  if (/[\d%％〇零一二三四五六七八九十百千万两]+/.test(s)) sc += 0.6;
  if (/[A-Za-z]{3,}/.test(s)) sc += 0.3;

  let bi = 0;
  for (const g of materialBigrams) {
    if (g.length === 2 && s.includes(g)) bi += 1;
  }
  sc += Math.min(4.5, bi * 0.12);

  let ph = 0;
  for (const p of topicPhrases) {
    if (p.length >= 3 && s.includes(p)) ph += 1.2;
  }
  sc += Math.min(5, ph);

  const len = s.length;
  if (len >= 12 && len <= AUTO_PROGRAM_SUMMARY_MAX) sc += 2.2;
  else if (len > AUTO_PROGRAM_SUMMARY_MAX && len <= 48) sc += 0.6;
  else if (len > 52) sc -= 1.2;

  if (total > 2) {
    const pos = index / Math.max(1, total - 1);
    if (pos >= 0.18 && pos <= 0.82) sc += 1.4;
    if (pos < 0.08 || pos > 0.94) sc -= 1.1;
  }

  return sc;
}

function normalizeSummarySentence(s: string): string {
  return s
    .replace(/[。！？!?…]+$/g, "")
    .replace(/^\s*(?:那么|所以|然后|接下来|其实|不过|但是)[，,]\s*/g, "")
    .trim();
}

/**
 * 从口播逐行、合并正文与素材中收集「可打分」的句子，缓解仅按句号切分漏掉重点句的问题。
 */
function collectSummaryCandidateSentences(scriptRaw: string, userSourceText: string): string[] {
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const b = stripMarkdownishHeaders(userSourceText);
  const merged = stripTtsInlineArtifacts(`${a}\n${b}`.replace(/\s+/g, " ")).trim();
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, " ");
    if (t.length < 6) return;
    const key = t.slice(0, 28);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const s of splitIntoSentences(merged)) add(s);
  const lead = extractSummaryLeadFromScriptText(String(scriptRaw || "").trim(), 420);
  for (const s of splitIntoSentences(lead)) add(s);
  for (const line of String(scriptRaw || "").split(/\r?\n/)) {
    const L = stripSpeakerLinePrefix(line).trim();
    if (L.length >= 14 && L.length <= 200) add(L);
  }
  return out;
}

/**
 * 节目简介：≤30 字；提炼主要讨论点，通俗、有吸引力；优先与素材主题重合、含观点/结构信号、弱化开场套话。
 */
export function deriveProgramSummaryOverallMax30(scriptRaw: string, userSourceText: string): string {
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const scriptFlat = stripTtsInlineArtifacts(a).replace(/\s+/g, "");
  const merged = stripTtsInlineArtifacts(
    `${a}\n${stripMarkdownishHeaders(userSourceText)}`.replace(/\s+/g, " ")
  ).trim();
  if (!merged && !scriptRaw.trim()) return "";

  const sentences = collectSummaryCandidateSentences(scriptRaw, userSourceText).filter((s) => s.length >= 6);
  if (sentences.length === 0) {
    const flat = merged.replace(/\s+/g, "");
    if (!flat) return "";
    return truncateSmart(flat, AUTO_PROGRAM_SUMMARY_MAX);
  }

  const materialBigrams = extractMaterialBigrams(userSourceText);
  const topicPhrases = extractTopicPhrasesAnchoredInScript(userSourceText, scriptFlat);

  const scored = sentences.map((s, i) => ({
    raw: s,
    score: scoreSentenceForSummary(s, materialBigrams, topicPhrases, i, sentences.length)
  }));
  scored.sort((x, y) => y.score - x.score);

  const top = scored[0];
  if (!top || top.score < -2) {
    const mid = sentences[Math.floor(sentences.length / 2)] || sentences[0]!;
    return truncateSmart(normalizeSummarySentence(mid), AUTO_PROGRAM_SUMMARY_MAX);
  }

  let primary = normalizeSummarySentence(top.raw);
  if (!primary) primary = normalizeSummarySentence(scored[0]!.raw);

  let out = primary;
  if (out.length > AUTO_PROGRAM_SUMMARY_MAX) {
    out = truncateSmart(out, AUTO_PROGRAM_SUMMARY_MAX);
  } else if (top.score < -0.5 && a.trim()) {
    const leadFallback = truncateSmart(
      normalizeSummarySentence(extractSummaryLeadFromScriptText(scriptRaw, 85)),
      AUTO_PROGRAM_SUMMARY_MAX
    );
    if (leadFallback.length >= 14) {
      out = leadFallback;
    }
  }
  if (out.length < 18 && scored.length >= 2) {
    const second = scored.slice(1).find(
      (x) => normalizeSummarySentence(x.raw).length >= 10 && x.score >= top.score - 2
    );
    if (second) {
      const p2 = normalizeSummarySentence(second.raw);
      const tail = p2.length > 14 ? truncateSmart(p2, 14) : p2;
      const combined = `${out}，${tail}`;
      out =
        combined.length <= AUTO_PROGRAM_SUMMARY_MAX
          ? combined
          : truncateSmart(combined, AUTO_PROGRAM_SUMMARY_MAX);
    }
  }

  return out;
}

/** @deprecated 使用 deriveProgramSummaryOverallMax30 */
export const deriveProgramSummaryOverallMax50 = deriveProgramSummaryOverallMax30;

function humanizeAudioChapterTitle(raw: string): string {
  const t = String(raw || "").trim();
  const stripped = t.replace(/^说话人[12]\s*·\s*/i, "").trim();
  return stripped || t || "章节";
}

function splitScriptIntoWeightedSegments(scriptRaw: string, maxSeg = 10, minSeg = 4): string[] {
  const lines = String(scriptRaw || "")
    .split(/\r?\n/)
    .map((l) => stripSpeakerLinePrefix(l).trim())
    .filter(Boolean);
  if (lines.length === 0) {
    const flat = stripDialogueMarkersFromBlurb(scriptRaw).trim();
    if (!flat) return [];
    const sentences = splitIntoSentences(flat);
    if (sentences.length === 0) return [flat];
    const target = Math.min(maxSeg, Math.max(minSeg, Math.ceil(sentences.length / 3)));
    const step = Math.max(1, Math.ceil(sentences.length / target));
    const out: string[] = [];
    for (let i = 0; i < sentences.length; i += step) {
      out.push(sentences.slice(i, i + step).join(""));
    }
    return out.filter(Boolean);
  }
  const target = Math.min(maxSeg, Math.max(minSeg, Math.ceil(lines.length / 5)));
  const chunk = Math.max(1, Math.ceil(lines.length / target));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += chunk) {
    out.push(lines.slice(i, i + chunk).join(" ").replace(/\s+/g, " ").trim());
  }
  return out.filter((s) => s.length > 0);
}

/**
 * 时间轴：优先用 TTS 返回的 audio_chapters（与合成切段一致）；否则按文稿块权重 + 音频时长比例估算起点。
 */
export function buildChapterTimelineMarkdownLines(
  scriptRaw: string,
  audioChapters: Array<{ title: string; start_ms: number; end_ms?: number }> | undefined,
  durationSec: number | null | undefined
): string[] {
  const ch = audioChapters || [];
  const onlyFull =
    ch.length === 1 && String(ch[0]?.title || "").trim() === "全文" && (Number(ch[0]?.start_ms) || 0) === 0;
  const useful = ch.length > 1 || (ch.length === 1 && !onlyFull);
  if (useful) {
    return formatChapterMarkdownLines(
      ch.map((c) => ({
        title: humanizeAudioChapterTitle(String(c.title || "章节")),
        start_ms: Number(c.start_ms) || 0
      }))
    );
  }
  return inferChaptersFromScriptAndDuration(scriptRaw, durationSec);
}

function inferChaptersFromScriptAndDuration(scriptRaw: string, durationSec: number | null | undefined): string[] {
  const segs = splitScriptIntoWeightedSegments(scriptRaw, 10, 4);
  if (segs.length === 0) {
    return ["- [0:00 开篇](t:0)"];
  }
  const weights = segs.map((s) => Math.max(8, s.length));
  const tw = weights.reduce((a, b) => a + b, 0);
  const ds = Number(durationSec);
  const secTotal =
    Number.isFinite(ds) && ds > 0.5 ? ds : Math.max(90, Math.min(3600, Math.round((tw / 320) * 60)));
  const durationMs = Math.round(secTotal * 1000);
  let cumW = 0;
  const lines: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const startMs = Math.floor((durationMs * cumW) / tw);
    cumW += weights[i]!;
    const sec = Math.floor(startMs / 1000);
    const label = truncateSmart(stripTtsInlineArtifacts(segs[i]!).replace(/[「」【】]/g, ""), 22);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    const clock = `${mm}:${ss.toString().padStart(2, "0")}`;
    lines.push(`- [${clock} ${label}](t:${sec})`);
  }
  return lines;
}

/** 从任务 payload 收集参考链接（播客页「参考链接」、正文里的 URL） */
export function extractReferenceLinksFromPayload(payload: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pushBlock = (block: string) => {
    const re = /https?:\/\/[^\s)\]>"',]+/gi;
    for (const m of String(block || "").matchAll(re)) {
      const u = m[0]!.replace(/[),.;]+$/, "");
      if (u.length < 12 || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
  };
  pushBlock(String(payload.reference_urls || ""));
  pushBlock(String(payload.source_url || ""));
  pushBlock(String(payload.text || ""));
  return out;
}

function stripMarkdownishHeaders(block: string): string {
  return String(block || "")
    .split("\n")
    .map((l) => l.replace(/^\s*#+\s*/, "").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export type BuildShareCopyOptions = {
  /** 口播全文（可含 Speaker 行） */
  scriptRaw: string;
  payload: Record<string, unknown>;
  /** 任务 result，用于 result.title 等 */
  result?: Record<string, unknown>;
  /** 作品列表/分享入口带来的展示名（用户重命名时优先作单集标题） */
  displayTitleHint?: string;
  audioChaptersRaw?: Array<Record<string, unknown>>;
  audioDurationSec?: number | null;
  /** 各类用户标题都不可用时的兜底 */
  fallbackTitle: string;
  /** 无正文时的简介兜底（会截到 AUTO_PROGRAM_SUMMARY_MAX 字内） */
  fallbackSummary: string;
};

function truncateSummaryToAutoMax(s: string): string {
  const t = String(s || "").trim();
  if (t.length <= AUTO_PROGRAM_SUMMARY_MAX) return t;
  return `${t.slice(0, AUTO_PROGRAM_SUMMARY_MAX - 1)}…`;
}

function deriveKeyTakeawaysFromScript(
  scriptRaw: string,
  userSourceText: string,
  summaryUsed: string,
  maxItems: number
): string[] {
  const sentences = collectSummaryCandidateSentences(scriptRaw, userSourceText).filter((s) => s.length >= 12);
  if (sentences.length === 0) return [];
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const scriptFlat = stripTtsInlineArtifacts(a).replace(/\s+/g, "");
  const materialBigrams = extractMaterialBigrams(userSourceText);
  const topicPhrases = extractTopicPhrasesAnchoredInScript(userSourceText, scriptFlat);
  const scored = sentences.map((s, i) => ({
    raw: s,
    score: scoreSentenceForSummary(s, materialBigrams, topicPhrases, i, sentences.length)
  }));
  scored.sort((x, y) => y.score - x.score);
  const sumPrefix = (summaryUsed || "").replace(/\s+/g, "").slice(0, 28);
  const out: string[] = [];
  const tooSimilar = (a: string, b: string) => {
    const x = a.replace(/\s+/g, "").slice(0, 22);
    const y = b.replace(/\s+/g, "").slice(0, 22);
    return x === y || (x.length >= 14 && y.startsWith(x.slice(0, 14)));
  };
  for (const { raw } of scored) {
    const n = normalizeSummarySentence(raw);
    if (n.length < 16) continue;
    const pfx = n.replace(/\s+/g, "").slice(0, 28);
    if (sumPrefix.length >= 12 && (pfx === sumPrefix || pfx.startsWith(sumPrefix.slice(0, 16)))) continue;
    if (out.some((x) => tooSimilar(x, n))) continue;
    out.push(truncateSmart(n, 72));
    if (out.length >= maxItems) break;
  }
  return out.slice(0, maxItems);
}

/** 最靠前的 1～2 条「主线句」，用于 Show Notes 开篇，避免整页碎片化列表。 */
function deriveCoreThreadBullets(
  scriptRaw: string,
  userSourceText: string,
  summaryLine: string,
  maxItems: number
): string[] {
  const sentences = collectSummaryCandidateSentences(scriptRaw, userSourceText).filter((s) => s.length >= 14);
  if (sentences.length === 0) return [];
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const scriptFlat = stripTtsInlineArtifacts(a).replace(/\s+/g, "");
  const materialBigrams = extractMaterialBigrams(userSourceText);
  const topicPhrases = extractTopicPhrasesAnchoredInScript(userSourceText, scriptFlat);
  const scored = sentences
    .map((s, i) => ({
      raw: s,
      score: scoreSentenceForSummary(s, materialBigrams, topicPhrases, i, sentences.length)
    }))
    .filter((x) => x.score >= -0.3);
  scored.sort((x, y) => y.score - x.score);
  const sumN = (summaryLine || "").replace(/\s+/g, "").slice(0, 24);
  const out: string[] = [];
  for (const { raw } of scored) {
    const n = normalizeSummarySentence(raw);
    if (n.length < 16 || n.length > 96) continue;
    const p = n.replace(/\s+/g, "").slice(0, 24);
    if (sumN.length >= 10 && (p === sumN || p.startsWith(sumN.slice(0, 12)))) continue;
    if (out.some((x) => x.slice(0, 16) === n.slice(0, 16))) continue;
    out.push(truncateSmart(n, 88));
    if (out.length >= maxItems) break;
  }
  return out.slice(0, maxItems);
}

function deriveGoldenQuotesFromScript(scriptRaw: string, userSourceText: string, max: number): string[] {
  const sentences = collectSummaryCandidateSentences(scriptRaw, userSourceText).filter(
    (s) => s.length >= 10 && s.length <= 120
  );
  if (sentences.length === 0) return [];
  const a = stripDialogueMarkersFromBlurb(scriptRaw);
  const scriptFlat = stripTtsInlineArtifacts(a).replace(/\s+/g, "");
  const materialBigrams = extractMaterialBigrams(userSourceText);
  const topicPhrases = extractTopicPhrasesAnchoredInScript(userSourceText, scriptFlat);
  const scored = sentences.map((s, i) => ({
    raw: s,
    score: scoreSentenceForSummary(s, materialBigrams, topicPhrases, i, sentences.length)
  }));
  scored.sort((x, y) => y.score - x.score);
  const out: string[] = [];
  for (const { raw } of scored) {
    const n = normalizeSummarySentence(raw);
    if (n.length < 12 || n.length > 88) continue;
    const line = truncateSmart(n, 72);
    if (out.some((o) => o.slice(0, 24) === line.slice(0, 24))) continue;
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function deriveResourceBulletsFromPayload(payload: Record<string, unknown>, scriptRaw: string): string[] {
  const links = extractReferenceLinksFromPayload(payload);
  const lines = String(scriptRaw)
    .split(/\r?\n/)
    .map((l) => stripSpeakerLinePrefix(l).trim())
    .filter(Boolean);
  const hints: string[] = [];
  for (const line of lines) {
    if (
      /(?:工具|软件|方法|API|插件|模型|官网|网站|平台|资源|框架|书籍|论文|报告)/.test(line) &&
      line.length < 140
    ) {
      hints.push(truncateSmart(line.replace(/^[-*]\s*/, "").trim(), 100));
    }
  }
  const linkLines = links.map((u) => `链接：${u}`);
  const merged = [...linkLines, ...hints];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of merged) {
    const k = m.slice(0, 36);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= 8) break;
  }
  return out;
}

function buildStructuredShowNotesMarkdown(
  summaryLine: string,
  scriptRaw: string,
  payload: Record<string, unknown>,
  timelineLines: string[]
): string {
  const theme = summaryLine.trim() || "（请补充本期主题）";
  const payloadText = String(payload.text || "");
  const coreThread = deriveCoreThreadBullets(scriptRaw, payloadText, summaryLine, 2);
  const takeaways = deriveKeyTakeawaysFromScript(scriptRaw, payloadText, summaryLine, 4);
  const quotes = deriveGoldenQuotesFromScript(scriptRaw, payloadText, 3);
  const resources = deriveResourceBulletsFromPayload(payload, scriptRaw);

  const parts: string[] = [
    "## 本期在讲什么",
    "",
    ...(coreThread.length
      ? coreThread.map((t) => `- ${t}`)
      : [`- ${truncateSmart(theme.replace(/。$/, ""), 80)}`]),
    "",
    "## 本期主题（一句话）",
    "",
    theme,
    "",
    "## 关键要点",
    "",
    ...(takeaways.length ? takeaways.map((t) => `- ${t}`) : ["- （可据文稿补充几条听得懂的要点）"]),
    "",
    "## 时间轴",
    "",
    ...(timelineLines.length ? timelineLines : ["- [0:00 开篇](t:0)"]),
    "",
    "## 关键观点 / 金句",
    "",
    ...(quotes.length ? quotes.map((q) => `- ${q}`) : ["- （可提炼适合传播的短句）"]),
    "",
    "## 提到的工具 / 方法 / 资源",
    "",
    ...(resources.length ? resources.map((r) => `- ${r}`) : ["- （暂无）"]),
    ""
  ];
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 根据口播稿、任务 payload、音频章节与时长生成：≤30 字简介、结构化 Show Notes。
 * 节目标题由用户在发布页自行填写，此处 `episodeTitle` 恒为空字符串。
 */
export function buildSharePublishCopyFromScriptAndPayload(opts: BuildShareCopyOptions): ShareFormFields {
  const script = String(opts.scriptRaw || "").trim();
  const payloadText = String(opts.payload.text || "");
  const result = opts.result || {};

  let summary = "";
  if (script.length > 0 || payloadText.trim().length > 0) {
    summary = deriveProgramSummaryOverallMax30(script, payloadText);
  }
  if (!summary.trim()) {
    summary = truncateSummaryToAutoMax(opts.fallbackSummary || defaultSummaryFromJobResult(result));
  } else {
    summary = truncateSummaryToAutoMax(summary);
  }

  const chaptersParsed =
    Array.isArray(opts.audioChaptersRaw) && opts.audioChaptersRaw.length > 0
      ? opts.audioChaptersRaw.map((o) => ({
          title: String(o.title || "章节"),
          start_ms: Number(o.start_ms) || 0,
          end_ms: o.end_ms != null ? Number(o.end_ms) : undefined
        }))
      : undefined;

  const timelineLines = buildChapterTimelineMarkdownLines(script, chaptersParsed, opts.audioDurationSec ?? null);

  const showNotes = buildStructuredShowNotesMarkdown(summary, script, opts.payload, timelineLines);

  return {
    episodeTitle: "",
    summary,
    showNotes
  };
}

/**
 * 将「- 1:23 章节名」类列表行转为 `[时钟 标题](t:秒)`，便于预览与 RSS 内跳转。
 * 已含 `(t:` 或 `[...](` 的行不修改。
 */
export function promotePlainTimestampLinesInMarkdown(md: string): string {
  const lines = (md || "").split("\n");
  const bulletTime = /^(\s*[-*]\s+)(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;
  return lines
    .map((line) => {
      if (/\(t:\d+\)/.test(line) || /\[[^\]]+\]\([^)]+\)/.test(line)) return line;
      const m = line.match(bulletTime);
      if (!m) return line;
      const prefix = m[1];
      const clock = m[2];
      const rest = m[3].trim();
      const sec = parseClockToSeconds(clock);
      if (sec == null) return line;
      return `${prefix}[${clock} ${rest}](t:${sec})`;
    })
    .join("\n");
}

function parseClockToSeconds(clock: string): number | null {
  const parts = clock.split(":").map((x) => Number.parseInt(x, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

export type SharePublishHints = {
  titleOverSoft: boolean;
  summaryEmpty: boolean;
  summaryOverIdeal: boolean;
  summaryOverWarn: boolean;
  summaryLooksLikeDialogue: boolean;
  showNotesVeryShort: boolean;
};

export function computeSharePublishHints(title: string, summary: string, showNotes: string): SharePublishHints {
  const t = title.trim();
  const s = summary.trim();
  const n = showNotes.trim();
  const dialoguePattern = /(speaker\s*[12]\s*[:：]|说话人\s*[12]\s*[:：]|^S[12]\s*[:：])/im;
  return {
    titleOverSoft: t.length > SHARE_TITLE_SOFT_MAX,
    summaryEmpty: s.length === 0,
    summaryOverIdeal: s.length > SHARE_SUMMARY_IDEAL_MAX,
    summaryOverWarn: s.length > SHARE_SUMMARY_WARN_MAX,
    summaryLooksLikeDialogue: dialoguePattern.test(s) && s.length > 80,
    showNotesVeryShort: n.length > 0 && n.length < 180
  };
}

const DRAFT_KEY_PREFIX = "fym_share_draft_v2:";

export type ShareFormDraft = {
  episodeTitle: string;
  summary: string;
  showNotes: string;
  savedAt: number;
};

export type ShareFormFields = Omit<ShareFormDraft, "savedAt">;

export function shareFormFieldsDiffer(a: ShareFormFields, b: ShareFormFields): boolean {
  return a.episodeTitle !== b.episodeTitle || a.summary !== b.summary || a.showNotes !== b.showNotes;
}

export function loadShareFormDraft(jobId: string): ShareFormDraft | null {
  try {
    const raw = readLocalStorageScoped(DRAFT_KEY_PREFIX + jobId);
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || typeof j !== "object") return null;
    const savedAt = typeof j.savedAt === "number" ? j.savedAt : 0;
    if (!savedAt || Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return null;
    return {
      episodeTitle: String(j.episodeTitle ?? ""),
      summary: String(j.summary ?? ""),
      showNotes: String(j.showNotes ?? ""),
      savedAt
    };
  } catch {
    return null;
  }
}

export function saveShareFormDraft(jobId: string, draft: Omit<ShareFormDraft, "savedAt">): void {
  try {
    const payload: ShareFormDraft = { ...draft, savedAt: Date.now() };
    writeLocalStorageScoped(DRAFT_KEY_PREFIX + jobId, JSON.stringify(payload));
  } catch {
    /* quota / privacy */
  }
}

export function clearShareFormDraft(jobId: string): void {
  try {
    removeLocalStorageScoped(DRAFT_KEY_PREFIX + jobId);
  } catch {
    /* ignore */
  }
}
