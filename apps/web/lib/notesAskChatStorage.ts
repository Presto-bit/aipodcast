/**
 * 知识库「向资料提问」对话持久化（账号 + 笔记本 + **笔记本代次盐**）。
 * v4：同一笔记本下对话与左侧「勾选哪些资料」无关，避免换勾选就换一套会话。
 * v3 及更早：曾按选中笔记 ID 分桶；首次进入 v4 时从同笔记本下最长的 v3 记录迁移一次。
 */

import type { NotesAskSource } from "./notesAskCitation";
import { normalizeNotesAskSources } from "./notesAskCitation";
import {
  getStorageAccountKey,
  readLocalStorageScoped,
  writeLocalStorageScoped
} from "./userScopedStorage";

export type SerializedNotesAskTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 助手消息可选：与编排器 sources 一致，用于 [n] 脚注与内链 */
  sources?: NotesAskSource[];
  /** 知识库引导气泡：可点击填入输入框的建议问句 */
  hintSuggestions?: string[];
  /** 单轮回答结束后，编排器返回的「接着问」建议（至多 1 条） */
  followUpQuestions?: string[];
};

const STORAGE_VERSION = 1;
/** v2：纳入选中笔记 ID；v3：再纳入 askSalt；v4：不再按勾选分桶 */
const KEY_SCHEMA = 4;
const V3_PREFIX = "fym_notes_ask_chat_v3:";
const MAX_MESSAGES = 120;

type StoredPayload = {
  v: number;
  messages: SerializedNotesAskTurn[];
};

/** 逻辑键（再经 userScopedStorage 拼账号后缀） */
export function notesAskChatBaseKey(notebookScoped: string, askSalt: string): string {
  const nb = notebookScoped.trim();
  const salt = (askSalt || "").trim() || "0";
  return `fym_notes_ask_chat_v${KEY_SCHEMA}:${encodeURIComponent(nb)}:${encodeURIComponent(salt)}`;
}

function parseStored(raw: string): SerializedNotesAskTurn[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const v = (parsed as StoredPayload).v;
    if (v !== STORAGE_VERSION) return null;
    const messages = (parsed as StoredPayload).messages;
    if (!Array.isArray(messages)) return null;
    if (messages.length === 0) return [];
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
        .slice(0, 1);
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
    return out;
  } catch {
    return null;
  }
}

const SCOPE_SEP = "::u::";

function storagePhysicalBaseKey(fullKey: string): string {
  const idx = fullKey.indexOf(SCOPE_SEP);
  return idx === -1 ? fullKey : fullKey.slice(0, idx);
}

function scopedKeySuffixForCurrentAccount(): string {
  return `${SCOPE_SEP}${encodeURIComponent(getStorageAccountKey())}`;
}

/** 解析 v3 逻辑键中三段 URI 组件（笔记本 / scope / salt） */
function parseV3LogicalBase(logicalBase: string): { nb: string; salt: string } | null {
  if (!logicalBase.startsWith(V3_PREFIX)) return null;
  const rest = logicalBase.slice(V3_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  try {
    const nb = decodeURIComponent(parts[0]);
    const salt = decodeURIComponent(parts[2]) || "0";
    return { nb, salt };
  } catch {
    return null;
  }
}

/**
 * 从 localStorage 中同笔记本、同 askSalt 的全部 v3 分桶里，挑出消息最多的一条写入 v4 并返回。
 */
function migrateBestV3ChatIntoV4(notebookScoped: string, askSalt: string): SerializedNotesAskTurn[] | null {
  const nb = notebookScoped.trim();
  const wantSalt = (askSalt || "").trim() || "0";
  if (!nb || typeof window === "undefined") return null;

  let best: SerializedNotesAskTurn[] | null = null;
  let bestLen = 0;
  const v3KeysToRemove: string[] = [];

  const accountSuffix = scopedKeySuffixForCurrentAccount();

  for (let i = 0; i < window.localStorage.length; i++) {
    const fullKey = window.localStorage.key(i);
    if (!fullKey || !fullKey.startsWith(V3_PREFIX)) continue;
    const isScoped = fullKey.includes(SCOPE_SEP);
    if (isScoped && !fullKey.endsWith(accountSuffix)) continue;
    const logical = isScoped ? storagePhysicalBaseKey(fullKey) : fullKey;
    const parsed = parseV3LogicalBase(logical);
    if (!parsed || parsed.nb !== nb || parsed.salt !== wantSalt) continue;

    const raw = window.localStorage.getItem(fullKey);
    if (!raw) continue;
    const messages = parseStored(raw);
    const len = messages?.length ?? 0;
    if (len > bestLen) {
      bestLen = len;
      best = messages;
    }
    v3KeysToRemove.push(fullKey);
  }

  if (!best?.length) return null;

  try {
    const payload: StoredPayload = { v: STORAGE_VERSION, messages: best };
    writeLocalStorageScoped(notesAskChatBaseKey(nb, wantSalt), JSON.stringify(payload));
    for (const k of v3KeysToRemove) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return best;
  }
  return best;
}

/**
 * 加载某笔记本下的对话（与当前勾选资料无关）。
 * @param notebookScoped 与页面 `effectiveDraftNotebookKey` 一致（含 shared: 前缀时）
 * @param askSalt 笔记本代次（instanceId 或 createdAt），与 save 一致
 */
export function loadNotesAskChat(notebookScoped: string, askSalt: string): SerializedNotesAskTurn[] | null {
  const nb = notebookScoped.trim();
  if (!nb) return null;
  const bk = notesAskChatBaseKey(nb, askSalt);
  const raw = readLocalStorageScoped(bk);
  const fromV4 = raw ? parseStored(raw) : null;
  if (fromV4 !== null) return fromV4;
  return migrateBestV3ChatIntoV4(nb, askSalt);
}

export function saveNotesAskChat(
  notebookScoped: string,
  messages: SerializedNotesAskTurn[],
  askSalt: string
): void {
  try {
    const bk = notesAskChatBaseKey(notebookScoped.trim(), askSalt);
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
