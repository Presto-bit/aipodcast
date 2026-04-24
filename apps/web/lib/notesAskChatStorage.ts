/**
 * 知识库「向资料提问」对话持久化（账号 + 笔记本 + **选中笔记 ID 集合** 维度，与 userScopedStorage 一致）。
 * 按笔记 ID 分区：删除后新建同标题笔记（新 ID）不会继承旧对话。
 */

import type { NotesAskSource } from "./notesAskCitation";
import { normalizeNotesAskSources } from "./notesAskCitation";
import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";

export type SerializedNotesAskTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 助手消息可选：与编排器 sources 一致，用于 [n] 脚注与内链 */
  sources?: NotesAskSource[];
  /** 知识库引导气泡：可点击填入输入框的建议问句 */
  hintSuggestions?: string[];
};

const STORAGE_VERSION = 1;
/** 存储键分区：v2 起在键名中纳入选中笔记 ID，与仅按笔记本的 v1 键区分 */
const KEY_SCHEMA = 2;
const MAX_MESSAGES = 120;

type StoredPayload = {
  v: number;
  messages: SerializedNotesAskTurn[];
};

/** 逻辑键（再经 userScopedStorage 拼账号后缀） */
export function notesAskChatBaseKey(notebookScoped: string, noteIds: string[]): string {
  const nb = notebookScoped.trim();
  const sorted = [...noteIds].filter(Boolean).sort();
  const scope = sorted.length ? sorted.join("|") : "_none_";
  return `fym_notes_ask_chat_v${KEY_SCHEMA}:${encodeURIComponent(nb)}:${encodeURIComponent(scope)}`;
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
      const h1 = (m as { hint_suggestions?: unknown }).hint_suggestions;
      const h2 = (m as { hintSuggestions?: unknown }).hintSuggestions;
      const hintArr = Array.isArray(h1) ? h1 : Array.isArray(h2) ? h2 : [];
      const hintSuggestions = hintArr
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 8);
      out.push({
        id,
        role,
        content,
        ...(src && role === "assistant" ? { sources: src } : {}),
        ...(hintSuggestions.length && role === "assistant" ? { hintSuggestions } : {})
      });
      if (out.length >= MAX_MESSAGES) break;
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * 加载某笔记本 + 当前选中笔记集合下的对话。
 * @param notebookScoped 与页面 `effectiveDraftNotebookKey` 一致（含 shared: 前缀时）
 */
export function loadNotesAskChat(notebookScoped: string, noteIds: string[]): SerializedNotesAskTurn[] | null {
  const nb = notebookScoped.trim();
  if (!nb) return null;
  const bk = notesAskChatBaseKey(nb, noteIds);
  const raw = readLocalStorageScoped(bk);
  if (!raw) return null;
  return parseStored(raw);
}

export function saveNotesAskChat(notebookScoped: string, noteIds: string[], messages: SerializedNotesAskTurn[]): void {
  try {
    const bk = notesAskChatBaseKey(notebookScoped.trim(), noteIds);
    const trimmed = messages.slice(-MAX_MESSAGES).map((m) => {
      const base: SerializedNotesAskTurn = { id: m.id, role: m.role, content: m.content };
      if (m.role === "assistant" && m.sources?.length) {
        base.sources = m.sources;
      }
      if (m.role === "assistant" && m.hintSuggestions?.length) {
        base.hintSuggestions = m.hintSuggestions;
      }
      return base;
    });
    const payload: StoredPayload = { v: STORAGE_VERSION, messages: trimmed };
    writeLocalStorageScoped(bk, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
