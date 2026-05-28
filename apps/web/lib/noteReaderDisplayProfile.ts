/** 知识库资料阅读器展示形态（M0） */

export type NoteDisplayProfile = "prose" | "web" | "table" | "citation" | "unavailable";

export type NotePageBreak = { page: number; charStart: number };

export type NoteDisplayProfileInput = {
  ext?: string;
  sourceUrl?: string;
  inputType?: string;
  citationView?: boolean;
  text?: string;
  parseState?: string;
  parseStatus?: string;
  parseGate?: string;
};

const TABLE_EXT = new Set(["csv", "xls", "xlsx"]);
const WEB_EXT = new Set(["url", "web"]);

export function normalizeNoteExt(ext?: string): string {
  return String(ext || "")
    .trim()
    .toLowerCase();
}

export function isTableExt(ext?: string): boolean {
  return TABLE_EXT.has(normalizeNoteExt(ext));
}

export function deriveDisplayProfile(input: NoteDisplayProfileInput): NoteDisplayProfile {
  if (input.citationView) return "citation";
  const gate = String(input.parseGate || "").trim();
  const parseState = String(input.parseState || "").trim();
  const parseStatus = String(input.parseStatus || "").trim();
  const textLen = String(input.text || "").replace(/\s+/g, "").length;
  if (parseState === "pending" || parseState === "parsing") {
    return "prose";
  }
  if (gate === "blocked" || parseState === "failed" || (parseStatus && parseStatus !== "ok" && textLen < 20)) {
    return "unavailable";
  }
  if (textLen < 20 && parseState !== "partial") {
    return "unavailable";
  }
  const ext = normalizeNoteExt(input.ext);
  if (TABLE_EXT.has(ext)) return "table";
  if (String(input.sourceUrl || "").trim() || WEB_EXT.has(ext)) return "web";
  return "prose";
}

export function profileDefaultSimplified(profile: NoteDisplayProfile): boolean {
  return profile === "web";
}

export function profileShowDownload(profile: NoteDisplayProfile, inputType?: string): boolean {
  if (profile === "citation") return false;
  return String(inputType || "").trim() === "note_file";
}

export function profileShowOpenSource(profile: NoteDisplayProfile, sourceUrl?: string): boolean {
  return profile === "web" && Boolean(String(sourceUrl || "").trim());
}

export function profileShowToc(profile: NoteDisplayProfile): boolean {
  return profile === "prose" || profile === "web" || profile === "citation";
}

export function profileShowSimplifiedToggle(profile: NoteDisplayProfile): boolean {
  return profile === "prose" || profile === "web";
}

export function profileTypeLabel(ext?: string, profile?: NoteDisplayProfile): string {
  const e = normalizeNoteExt(ext);
  if (profile === "web") return "网页";
  if (profile === "table") {
    if (e === "csv") return "CSV";
    if (e === "xlsx" || e === "xls") return "表格";
    return "表格";
  }
  if (profile === "citation") return "引用";
  if (e === "pdf") return "PDF";
  if (e === "doc" || e === "docx") return "Word";
  if (e === "epub") return "EPUB";
  if (e === "md" || e === "markdown") return "MD";
  if (e === "html" || e === "htm" || e === "xhtml") return "HTML";
  if (e === "txt") return "TXT";
  if (e === "url" || e === "web") return "网页";
  return e ? e.toUpperCase() : "资料";
}

export function sourceUrlHostname(sourceUrl?: string): string {
  const raw = String(sourceUrl || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./i, "");
  } catch {
    return raw.slice(0, 48);
  }
}
