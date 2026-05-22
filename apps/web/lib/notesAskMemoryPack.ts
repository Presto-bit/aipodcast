/**
 * 知识库对话：按字符预算打包 L1 verbatim + L2 sessionState（用户无感）。
 */

import type {
  NotesAskMemoryTurn,
  NotesAskSessionState,
  PackNotesAskMemoryResult,
  PackedNotesAskChatRow
} from "./notesAskMemoryTypes";

const VERBATIM_BUDGET = 7_500;
const PER_ROW_API_MAX = 2_000;
const PER_ROW_HEAD = 420;
const PER_ROW_TAIL = 420;
const MAX_HISTORY_ROWS = 24;

function trimForApi(content: string): string {
  const t = content.trim();
  if (t.length <= PER_ROW_API_MAX) return t;
  const head = t.slice(0, PER_ROW_HEAD);
  const tail = t.slice(-PER_ROW_TAIL);
  return `${head}\n…\n${tail}`;
}

function rowApiChars(row: PackedNotesAskChatRow): number {
  return trimForApi(row.content).length;
}

function toPackedRow(m: NotesAskMemoryTurn): PackedNotesAskChatRow | null {
  const content = (m.content || "").trim();
  if (!content) return null;
  const row: PackedNotesAskChatRow = {
    role: m.role,
    content: trimForApi(content)
  };
  if (m.role === "assistant" && m.activeChapters?.length) {
    row.activeChapters = m.activeChapters.slice(0, 6);
  }
  if (m.role === "assistant" && m.activeShards?.length) {
    row.activeShards = m.activeShards.slice(0, 6);
  }
  if (m.threadId?.trim()) row.threadId = m.threadId.trim();
  return row;
}

function normalizeSessionState(raw: NotesAskSessionState | null | undefined): NotesAskSessionState | null {
  if (!raw || raw.v !== 1) return null;
  const topic = String(raw.topic || "").trim().slice(0, 400);
  const threads = Array.isArray(raw.threads)
    ? raw.threads
        .slice(0, 8)
        .map((t) => ({
          id: String(t?.id || "").trim().slice(0, 40) || "t0",
          about: String(t?.about || "").trim().slice(0, 200),
          status: t?.status === "parked" ? ("parked" as const) : ("active" as const)
        }))
        .filter((t) => t.about)
    : [];
  const facts = Array.isArray(raw.facts)
    ? raw.facts.map((f) => String(f || "").trim().slice(0, 220)).filter(Boolean).slice(0, 12)
    : [];
  const prefs = Array.isArray(raw.prefs)
    ? raw.prefs.map((p) => String(p || "").trim().slice(0, 120)).filter(Boolean).slice(0, 6)
    : [];
  const turnCursor = Math.max(0, Math.min(9999, Number(raw.turnCursor) || 0));
  const sourcesRevision =
    raw.sourcesRevision != null ? Math.max(0, Math.min(999, Number(raw.sourcesRevision) || 0)) : undefined;
  if (!topic && !threads.length && !facts.length && !prefs.length && !turnCursor) return null;
  return { v: 1, topic, threads, facts, prefs, turnCursor, ...(sourcesRevision != null ? { sourcesRevision } : {}) };
}

/** 从最新消息向前装入 verbatim 预算 */
export function packNotesAskMemory(
  messages: NotesAskMemoryTurn[],
  sessionState: NotesAskSessionState | null | undefined,
  opts?: { excludeIds?: Set<string> }
): PackNotesAskMemoryResult {
  const exclude = opts?.excludeIds;
  const candidates = messages
    .filter((m) => !exclude?.has(m.id))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => (m.content || "").trim());

  const packed: PackedNotesAskChatRow[] = [];
  let used = 0;
  for (let i = candidates.length - 1; i >= 0 && packed.length < MAX_HISTORY_ROWS; i--) {
    const row = toPackedRow(candidates[i]!);
    if (!row) continue;
    const need = rowApiChars(row);
    if (packed.length > 0 && used + need > VERBATIM_BUDGET) break;
    packed.unshift(row);
    used += need;
  }

  return {
    chatHistory: packed,
    sessionState: normalizeSessionState(sessionState)
  };
}
