/**
 * 知识库「向资料提问」对话持久化（账号 + 笔记本 + **笔记本代次盐**）。
 * v5：消息 + 会话态（L2）+ 路由锚点（activeShards/activeChapters/threadId）。
 * v4：仅消息；读 v4 时静默迁入 v5。
 */

import type { NotesAskSource } from "./notesAskCitation";
import { normalizeNotesAskSources } from "./notesAskCitation";
import type {
  NotesAskRouteChapter,
  NotesAskRouteShard,
  NotesAskSessionState
} from "./notesAskMemoryTypes";
import { EMPTY_NOTES_ASK_SESSION_STATE } from "./notesAskMemoryTypes";
import {
  getStorageAccountKey,
  readLocalStorageScoped,
  writeLocalStorageScoped
} from "./userScopedStorage";

export type SerializedNotesAskTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: NotesAskSource[];
  hintSuggestions?: string[];
  followUpQuestions?: string[];
  activeChapters?: NotesAskRouteChapter[];
  activeShards?: NotesAskRouteShard[];
  threadId?: string;
};

export type NotesAskChatBundle = {
  messages: SerializedNotesAskTurn[];
  sessionState: NotesAskSessionState | null;
};

const STORAGE_VERSION = 1;
const KEY_SCHEMA = 5;
const V4_SCHEMA = 4;
const V3_PREFIX = "fym_notes_ask_chat_v3:";
const MAX_MESSAGES = 120;

type StoredPayloadV5 = {
  v: number;
  messages: SerializedNotesAskTurn[];
  sessionState?: NotesAskSessionState | null;
};

function parseRouteChapters(raw: unknown): NotesAskRouteChapter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesAskRouteChapter[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const noteId = String((c as NotesAskRouteChapter).noteId || "").trim();
    const chapterId = String((c as NotesAskRouteChapter).chapterId || "").trim();
    if (!noteId || !chapterId) continue;
    out.push({
      noteId,
      chapterId,
      title: String((c as NotesAskRouteChapter).title || "").trim().slice(0, 200) || undefined
    });
  }
  return out.length ? out.slice(0, 6) : undefined;
}

function parseRouteShards(raw: unknown): NotesAskRouteShard[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NotesAskRouteShard[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const noteId = String((c as NotesAskRouteShard).noteId || "").trim();
    const shardId = String((c as NotesAskRouteShard).shardId || "").trim();
    if (!noteId || !shardId) continue;
    out.push({
      noteId,
      shardId,
      title: String((c as NotesAskRouteShard).title || "").trim().slice(0, 200) || undefined
    });
  }
  return out.length ? out.slice(0, 6) : undefined;
}

function parseSessionState(raw: unknown): NotesAskSessionState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as NotesAskSessionState;
  if (s.v !== 1) return null;
  const topic = String(s.topic || "").trim().slice(0, 400);
  const threads = Array.isArray(s.threads)
    ? s.threads
        .slice(0, 8)
        .map((t) => ({
          id: String(t?.id || "").trim().slice(0, 40) || "t0",
          about: String(t?.about || "").trim().slice(0, 200),
          status: t?.status === "parked" ? ("parked" as const) : ("active" as const)
        }))
        .filter((t) => t.about)
    : [];
  const facts = Array.isArray(s.facts)
    ? s.facts.map((f) => String(f || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  const prefs = Array.isArray(s.prefs)
    ? s.prefs.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const turnCursor = Math.max(0, Math.min(9999, Number(s.turnCursor) || 0));
  const sourcesRevision =
    s.sourcesRevision != null ? Math.max(0, Math.min(999, Number(s.sourcesRevision) || 0)) : undefined;
  if (!topic && !threads.length && !facts.length && !turnCursor) return null;
  return { v: 1, topic, threads, facts, prefs, turnCursor, ...(sourcesRevision != null ? { sourcesRevision } : {}) };
}

function parseMessageRow(m: unknown): SerializedNotesAskTurn | null {
  if (!m || typeof m !== "object") return null;
  const id = String((m as SerializedNotesAskTurn).id || "").trim();
  const role = (m as SerializedNotesAskTurn).role;
  if (!id || (role !== "user" && role !== "assistant")) return null;
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
  const ac = parseRouteChapters(
    (m as { activeChapters?: unknown }).activeChapters ?? (m as { active_chapters?: unknown }).active_chapters
  );
  const ash = parseRouteShards(
    (m as { activeShards?: unknown }).activeShards ?? (m as { active_shards?: unknown }).active_shards
  );
  const threadId = String((m as { threadId?: unknown }).threadId || "").trim().slice(0, 40) || undefined;
  return {
    id,
    role,
    content,
    ...(src && role === "assistant" ? { sources: src } : {}),
    ...(hintSuggestions.length && role === "assistant" ? { hintSuggestions } : {}),
    ...(followUpQuestions.length && role === "assistant" ? { followUpQuestions } : {}),
    ...(ac?.length && role === "assistant" ? { activeChapters: ac } : {}),
    ...(ash?.length && role === "assistant" ? { activeShards: ash } : {}),
    ...(threadId ? { threadId } : {})
  };
}

function parseStoredPayload(raw: string): NotesAskChatBundle | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const v = (parsed as StoredPayloadV5).v;
    if (v !== STORAGE_VERSION) return null;
    const messages = (parsed as StoredPayloadV5).messages;
    if (!Array.isArray(messages)) return null;
    const out: SerializedNotesAskTurn[] = [];
    for (const m of messages) {
      const row = parseMessageRow(m);
      if (row) out.push(row);
      if (out.length >= MAX_MESSAGES) break;
    }
    const sessionState = parseSessionState((parsed as StoredPayloadV5).sessionState);
    return { messages: out, sessionState };
  } catch {
    return null;
  }
}

/** 逻辑键（再经 userScopedStorage 拼账号后缀） */
export function notesAskChatBaseKey(notebookScoped: string, askSalt: string): string {
  const nb = notebookScoped.trim();
  const salt = (askSalt || "").trim() || "0";
  return `fym_notes_ask_chat_v${KEY_SCHEMA}:${encodeURIComponent(nb)}:${encodeURIComponent(salt)}`;
}

function notesAskChatV4Key(notebookScoped: string, askSalt: string): string {
  const nb = notebookScoped.trim();
  const salt = (askSalt || "").trim() || "0";
  return `fym_notes_ask_chat_v${V4_SCHEMA}:${encodeURIComponent(nb)}:${encodeURIComponent(salt)}`;
}

const SCOPE_SEP = "::u::";

function storagePhysicalBaseKey(fullKey: string): string {
  const idx = fullKey.indexOf(SCOPE_SEP);
  return idx === -1 ? fullKey : fullKey.slice(0, idx);
}

function scopedKeySuffixForCurrentAccount(): string {
  return `${SCOPE_SEP}${encodeURIComponent(getStorageAccountKey())}`;
}

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

function migrateBestV3ChatIntoV5(notebookScoped: string, askSalt: string): NotesAskChatBundle | null {
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
    const bundle = parseStoredPayload(raw);
    const len = bundle?.messages.length ?? 0;
    if (len > bestLen) {
      bestLen = len;
      best = bundle?.messages ?? null;
    }
    v3KeysToRemove.push(fullKey);
  }

  if (!best?.length) return null;
  const migrated: NotesAskChatBundle = { messages: best, sessionState: null };
  saveNotesAskChatBundle(nb, migrated, wantSalt);
  for (const k of v3KeysToRemove) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  return migrated;
}

function serializeTurn(m: SerializedNotesAskTurn): SerializedNotesAskTurn {
  const base: SerializedNotesAskTurn = { id: m.id, role: m.role, content: m.content };
  if (m.role === "assistant" && m.sources?.length) base.sources = m.sources;
  if (m.role === "assistant" && m.hintSuggestions?.length) base.hintSuggestions = m.hintSuggestions;
  if (m.role === "assistant" && m.followUpQuestions?.length) base.followUpQuestions = m.followUpQuestions;
  if (m.role === "assistant" && m.activeChapters?.length) base.activeChapters = m.activeChapters;
  if (m.role === "assistant" && m.activeShards?.length) base.activeShards = m.activeShards;
  if (m.threadId) base.threadId = m.threadId;
  return base;
}

export function loadNotesAskChatBundle(notebookScoped: string, askSalt: string): NotesAskChatBundle | null {
  const nb = notebookScoped.trim();
  if (!nb) return null;

  const v5Raw = readLocalStorageScoped(notesAskChatBaseKey(nb, askSalt));
  const fromV5 = v5Raw ? parseStoredPayload(v5Raw) : null;
  if (fromV5 !== null) return fromV5;

  const v4Raw = readLocalStorageScoped(notesAskChatV4Key(nb, askSalt));
  const fromV4 = v4Raw ? parseStoredPayload(v4Raw) : null;
  if (fromV4?.messages.length) {
    saveNotesAskChatBundle(nb, fromV4, askSalt);
    return fromV4;
  }

  return migrateBestV3ChatIntoV5(nb, askSalt);
}

/** @deprecated 使用 loadNotesAskChatBundle */
export function loadNotesAskChat(notebookScoped: string, askSalt: string): SerializedNotesAskTurn[] | null {
  const bundle = loadNotesAskChatBundle(notebookScoped, askSalt);
  return bundle?.messages ?? null;
}

export function saveNotesAskChatBundle(
  notebookScoped: string,
  bundle: NotesAskChatBundle,
  askSalt: string
): void {
  try {
    const bk = notesAskChatBaseKey(notebookScoped.trim(), askSalt);
    const trimmed = bundle.messages.slice(-MAX_MESSAGES).map(serializeTurn);
    const payload: StoredPayloadV5 = {
      v: STORAGE_VERSION,
      messages: trimmed,
      sessionState: bundle.sessionState ?? null
    };
    writeLocalStorageScoped(bk, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

export function saveNotesAskChat(
  notebookScoped: string,
  messages: SerializedNotesAskTurn[],
  askSalt: string,
  sessionState?: NotesAskSessionState | null
): void {
  saveNotesAskChatBundle(
    notebookScoped,
    { messages, sessionState: sessionState ?? null },
    askSalt
  );
}

export function clearNotesAskChatBundle(notebookScoped: string, askSalt: string): void {
  saveNotesAskChatBundle(
    notebookScoped,
    { messages: [], sessionState: EMPTY_NOTES_ASK_SESSION_STATE() },
    askSalt
  );
}
