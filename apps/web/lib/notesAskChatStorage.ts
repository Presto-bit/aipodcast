/**
 * 知识库「向资料提问」对话持久化（账号 + 笔记本 + **选中笔记 ID 集合** + **笔记本代次盐**）。
 * - 按笔记 ID 分区：删除后新建同标题笔记（新 ID）不会继承旧对话。
 * - v3 起增加 askSalt（新建笔记本的 instanceId 或最早笔记 createdAt）：同名删除再建笔记本不会串会话。
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
  /** 单轮回答结束后，编排器返回的「接着问」建议（至多 2 条） */
  followUpQuestions?: string[];
};

const STORAGE_VERSION = 1;
/** v2：纳入选中笔记 ID；v3：再纳入 askSalt（笔记本代次，避免同名重建串会话） */
const KEY_SCHEMA = 3;
const MAX_MESSAGES = 120;

type StoredPayload = {
  v: number;
  messages: SerializedNotesAskTurn[];
};

/** 逻辑键（再经 userScopedStorage 拼账号后缀） */
export function notesAskChatBaseKey(notebookScoped: string, noteIds: string[], askSalt: string): string {
  const nb = notebookScoped.trim();
  const sorted = [...noteIds].filter(Boolean).sort();
  const scope = sorted.length ? sorted.join("|") : "_none_";
  const salt = (askSalt || "").trim() || "0";
  return `fym_notes_ask_chat_v${KEY_SCHEMA}:${encodeURIComponent(nb)}:${encodeURIComponent(scope)}:${encodeURIComponent(salt)}`;
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
      const f1 = (m as { follow_up_questions?: unknown }).follow_up_questions;
      const f2 = (m as { followUpQuestions?: unknown }).followUpQuestions;
      const fqArr = Array.isArray(f1) ? f1 : Array.isArray(f2) ? f2 : [];
      const followUpQuestions = fqArr
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 2);
      out.push({
        id,
        role,
        content,
        ...(src && role === "assistant" ? { sources: src } : {}),
        ...(hintSuggestions.length && role === "assistant" ? { hintSuggestions } : {}),
        ...(followUpQuestions.length && role === "assistant" ? { followUpQuestions } : {})
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
 * @param askSalt 笔记本代次（instanceId 或 createdAt），与 save 一致
 */
export function loadNotesAskChat(
  notebookScoped: string,
  noteIds: string[],
  askSalt: string
): SerializedNotesAskTurn[] | null {
  const nb = notebookScoped.trim();
  if (!nb) return null;
  const bk = notesAskChatBaseKey(nb, noteIds, askSalt);
  const raw = readLocalStorageScoped(bk);
  if (!raw) return null;
  return parseStored(raw);
}

export function saveNotesAskChat(
  notebookScoped: string,
  noteIds: string[],
  messages: SerializedNotesAskTurn[],
  askSalt: string
): void {
  try {
    const bk = notesAskChatBaseKey(notebookScoped.trim(), noteIds, askSalt);
    const trimmed = messages.slice(-MAX_MESSAGES).map((m) => {
      const base: SerializedNotesAskTurn = { id: m.id, role: m.role, content: m.content };
      if (m.role === "assistant" && m.sources?.length) {
        base.sources = m.sources;
      }
      if (m.role === "assistant" && m.hintSuggestions?.length) {
        base.hintSuggestions = m.hintSuggestions;
      }
      if (m.role === "assistant" && m.followUpQuestions?.length) {
        base.followUpQuestions = m.followUpQuestions;
      }
      return base;
    });
    const payload: StoredPayload = { v: STORAGE_VERSION, messages: trimmed };
    writeLocalStorageScoped(bk, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}
