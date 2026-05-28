/** 阅读器本地偏好（栏宽等） */

export type NoteReaderColumnWidth = "narrow" | "standard" | "wide";

const STORAGE_KEY = "note_reader_prefs_v1";

type Stored = {
  columnWidth?: NoteReaderColumnWidth;
};

const VALID_WIDTHS: NoteReaderColumnWidth[] = ["narrow", "standard", "wide"];

export function readNoteReaderColumnWidth(): NoteReaderColumnWidth {
  if (typeof window === "undefined") return "standard";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "standard";
    const o = JSON.parse(raw) as Stored;
    const w = o.columnWidth;
    if (w && VALID_WIDTHS.includes(w)) return w;
  } catch {
    /* ignore */
  }
  return "standard";
}

export function writeNoteReaderColumnWidth(columnWidth: NoteReaderColumnWidth): void {
  if (typeof window === "undefined") return;
  try {
    const prev = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Stored;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, columnWidth }));
  } catch {
    /* ignore */
  }
}

export function columnWidthClass(width: NoteReaderColumnWidth, isTable: boolean): string {
  if (isTable) return "w-full max-w-none";
  switch (width) {
    case "narrow":
      return "mx-auto w-full max-w-[34rem]";
    case "wide":
      return "mx-auto w-full max-w-[52rem]";
    default:
      return "mx-auto w-full max-w-[42rem]";
  }
}

export function columnWidthLabel(width: NoteReaderColumnWidth): string {
  if (width === "narrow") return "窄栏";
  if (width === "wide") return "宽栏";
  return "标准";
}

export function cycleColumnWidth(current: NoteReaderColumnWidth): NoteReaderColumnWidth {
  const i = VALID_WIDTHS.indexOf(current);
  return VALID_WIDTHS[(i + 1) % VALID_WIDTHS.length];
}
