/**
 * 知识库「向资料提问」对话持久化（账号 + 笔记本维度，与 userScopedStorage 一致）。
 */

import type { NotesAskSource } from "./notesAskCitation";
import { normalizeNotesAskSources } from "./notesAskCitation";
import { getStorageAccountKey, readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export type SerializedNotesAskTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 助手消息可选：与编排器 sources 一致，用于 [n] 脚注与内链 */
  sources?: NotesAskSource[];
};

const STORAGE_VERSION = 1;
const MAX_MESSAGES = 120;

type StoredPayload = {
  v: number;
  messages: SerializedNotesAskTurn[];
};

function baseKey(notebook: string): string {
  return `fym_notes_ask_chat_v${STORAGE_VERSION}:${encodeURIComponent(notebook.trim())}`;
}

function parseStored(raw: string): SerializedNotesAskTurn[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const v = (parsed as StoredPayload).v;
    if (v !== STORAGE_VERSION) return null;
    const messages = (parsed as StoredPayload).messages;
    if (!Array.isArray(messages)) return null;
    const out: SerializedNotesAskTurn[] = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const id = String((m as SerializedNotesAskTurn).id || "").trim();
      const role = (m as SerializedNotesAskTurn).role;
      if (!id || (role !== "user" && role !== "assistant")) continue;
      const content = String((m as SerializedNotesAskTurn).content ?? "");
      const src = normalizeNotesAskSources((m as SerializedNotesAskTurn).sources);
      out.push({
        id,
        role,
        content,
        ...(src && role === "assistant" ? { sources: src } : {})
      });
      if (out.length >= MAX_MESSAGES) break;
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** 旧键：fym_notes_ask_chat_v1:{accountKey}:{notebook} */
function readLegacyNotebookChat(notebook: string): string | null {
  if (typeof window === "undefined") return null;
  const enc = encodeURIComponent(notebook.trim());
  const acc = getStorageAccountKey();
  const keys = [`fym_notes_ask_chat_v${STORAGE_VERSION}:${acc}:${enc}`, `fym_notes_ask_chat_v${STORAGE_VERSION}:anon:${enc}`];
  for (const k of keys) {
    const raw = window.localStorage.getItem(k);
    if (raw) return raw;
  }
  return null;
}

function removeLegacyNotebookChat(notebook: string): void {
  if (typeof window === "undefined") return;
  const enc = encodeURIComponent(notebook.trim());
  const acc = getStorageAccountKey();
  const keys = [`fym_notes_ask_chat_v${STORAGE_VERSION}:${acc}:${enc}`, `fym_notes_ask_chat_v${STORAGE_VERSION}:anon:${enc}`];
  for (const k of keys) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

/**
 * 加载某笔记本下的对话；自动从旧键迁移到按 userScopedStorage 隔离的键。
 */
export function loadNotesAskChat(notebook: string): SerializedNotesAskTurn[] | null {
  const nb = notebook.trim();
  if (!nb) return null;
  const bk = baseKey(nb);
  let raw = readLocalStorageScoped(bk);
  if (!raw) {
    const leg = readLegacyNotebookChat(nb);
    if (leg) {
      writeLocalStorageScoped(bk, leg);
      removeLegacyNotebookChat(nb);
      raw = leg;
    }
  }
  if (!raw) return null;
  return parseStored(raw);
}

export function saveNotesAskChat(notebook: string, messages: SerializedNotesAskTurn[]): void {
  try {
    const bk = baseKey(notebook);
    const trimmed = messages.slice(-MAX_MESSAGES).map((m) => {
      const base = { id: m.id, role: m.role, content: m.content };
      if (m.role === "assistant" && m.sources?.length) {
        return { ...base, sources: m.sources };
      }
      return base;
    });
    const payload: StoredPayload = { v: STORAGE_VERSION, messages: trimmed };
    writeLocalStorageScoped(bk, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
