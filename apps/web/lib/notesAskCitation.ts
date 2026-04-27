/**
 * 知识库「向资料提问」：回答中的 [1]、[2] 与编排器返回的 sources 对齐，用于内链与脚注。
 */

export type NotesAskSourceChunk = {
  chunkIndex: string;
  score?: string;
  excerpt?: string;
};

export type NotesAskSource = {
  index: string;
  noteId: string;
  title: string;
  /** 向量检索块，供弹窗展示摘录 */
  chunks?: NotesAskSourceChunk[];
};

/** 联网检索来源，与笔记角标 [n] 分离，使用 [w1] 等 */
export type NotesAskWebSource = {
  index: string;
  title: string;
  url: string;
  snippet?: string;
};

function normalizeChunks(raw: unknown): NotesAskSourceChunk[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesAskSourceChunk[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const chunkIndex = String(o.chunkIndex ?? "").trim();
    const excerpt = String(o.excerpt ?? "").trim();
    const score = o.score != null ? String(o.score).trim() : "";
    if (!chunkIndex && !excerpt) continue;
    out.push({
      chunkIndex: chunkIndex || "—",
      ...(score ? { score } : {}),
      ...(excerpt ? { excerpt } : {})
    });
  }
  return out.length ? out : undefined;
}

export function normalizeNotesAskWebSources(raw: unknown): NotesAskWebSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesAskWebSource[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const index = String(o.index ?? "").trim();
    const title = String(o.title ?? "").trim();
    const url = String(o.url ?? "").trim();
    if (!index || !url) continue;
    const snippet = String(o.snippet ?? "").trim();
    out.push({
      index,
      title: title || url,
      url,
      ...(snippet ? { snippet } : {})
    });
  }
  return out.length ? out : undefined;
}

export function normalizeNotesAskSources(raw: unknown): NotesAskSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesAskSource[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const index = String(o.index ?? "").trim();
    const noteId = String(o.noteId ?? "").trim();
    const title = String(o.title ?? "").trim();
    if (!index || !noteId) continue;
    const chunks = normalizeChunks(o.chunks);
    out.push({
      index,
      noteId,
      title: title || noteId,
      ...(chunks ? { chunks } : {})
    });
  }
  return out.length ? out : undefined;
}

/**
 * 将正文中的 [n] 转为 Markdown 锚点链接（仅当 n 在 sources 中存在），便于渲染为可点击角标并跳转到脚注。
 */
export function linkifyCitationMarkers(text: string, sources: NotesAskSource[] | undefined): string {
  if (!sources?.length) return text;
  const valid = new Set(sources.map((s) => s.index));
  return text.replace(/\[(\d+)\]/g, (full, n: string) => {
    if (valid.has(n)) return `[${n}](#cite-${n})`;
    return full;
  });
}

/** 将 [w1] 转为锚点，供 Markdown 内链到脚注区（外链在渲染组件中解析 #cite-w*）。 */
export function linkifyWebCitationMarkers(text: string, webSources: NotesAskWebSource[] | undefined): string {
  if (!webSources?.length) return text;
  const valid = new Set(webSources.map((s) => s.index));
  return text.replace(/\[w(\d+)\]/gi, (_full, n: string) => {
    const key = `w${n}`;
    if (valid.has(key)) return `[w${n}](#cite-${key})`;
    return `[w${n}]`;
  });
}

export function citationTitleForIndex(sources: NotesAskSource[] | undefined, index: string): string {
  const s = sources?.find((x) => x.index === index);
  if (!s) return `来源 ${index}`;
  return `${s.title} · ${s.noteId.slice(0, 8)}…`;
}

export function citationTitleForWebIndex(webSources: NotesAskWebSource[] | undefined, index: string): string {
  const s = webSources?.find((x) => x.index === index);
  if (!s) return `网页 ${index}`;
  return s.title;
}
