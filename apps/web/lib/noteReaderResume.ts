/** 资料阅读续读位置（按 noteId 存 localStorage） */

export type NoteReaderResume = {
  noteId: string;
  blockId: string;
  label: string;
  scrollRatio: number;
  updatedAt: number;
};

const KEY_PREFIX = "note_reader_resume_v1:";

export function readNoteReaderResume(noteId: string): NoteReaderResume | null {
  if (typeof window === "undefined" || !noteId) return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${noteId}`);
    if (!raw) return null;
    const o = JSON.parse(raw) as NoteReaderResume;
    if (!o?.blockId) return null;
    return o;
  } catch {
    return null;
  }
}

export function writeNoteReaderResume(entry: Omit<NoteReaderResume, "updatedAt">): void {
  if (typeof window === "undefined" || !entry.noteId) return;
  try {
    const payload: NoteReaderResume = { ...entry, updatedAt: Date.now() };
    window.localStorage.setItem(`${KEY_PREFIX}${entry.noteId}`, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearNoteReaderResume(noteId: string): void {
  if (typeof window === "undefined" || !noteId) return;
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${noteId}`);
  } catch {
    /* ignore */
  }
}
