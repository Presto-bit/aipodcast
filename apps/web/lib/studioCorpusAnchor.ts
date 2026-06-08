import type { NotesAskSource } from "./notesAskCitation";

/** 成稿正文中的资料锚点（与生成 prompt 约定一致） */
export const STUDIO_CORPUS_ANCHOR_TOKEN_RE = /\[资料(\d+)\]/g;

export type CorpusAnchorSegment =
  | { kind: "text"; text: string }
  | { kind: "anchor"; label: string; index: string };

export function buildStudioCorpusSources(
  notebook: string,
  noteIds: string[]
): NotesAskSource[] {
  void notebook;
  return noteIds.map((noteId, i) => ({
    index: String(i + 1),
    noteId,
    title: `参考资料 ${i + 1}`
  }));
}

/** 将含 [资料N] 的文本拆成可点击片段 */
export function splitCorpusAnchorSegments(text: string): CorpusAnchorSegment[] {
  const segments: CorpusAnchorSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(STUDIO_CORPUS_ANCHOR_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "anchor", label: match[0]!, index: match[1]! });
    lastIndex = match.index + match[0]!.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments.length ? segments : [{ kind: "text", text }];
}

export function textHasCorpusAnchors(text: string): boolean {
  STUDIO_CORPUS_ANCHOR_TOKEN_RE.lastIndex = 0;
  return STUDIO_CORPUS_ANCHOR_TOKEN_RE.test(text);
}
