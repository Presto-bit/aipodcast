import { readLocalStorageScoped, writeLocalStorageScoped } from "./userScopedStorage";
import { expertSelectionFromLegacyFormats } from "./composerExperts";
import { backfillFeatureCoreFromProfile } from "./homeComposerFeatureCore";
import {
  defaultHomeComposerPrefs,
  type HomeComposerFormat,
  type HomeComposerPrefs,
  type HomeComposerSession,
  type HomeComposerStore,
  type HomeComposerTurn
} from "./homeComposerTypes";
import { EMPTY_NOTES_ASK_SESSION_STATE } from "./notesAskMemoryTypes";
import type { ComposerExpertSelection, WritingHabitMode } from "./homeComposerExpertTypes";

const STORAGE_KEY = "fym_home_composer_chat_v1";
const MAX_SESSIONS = 40;

function newSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}`;
}

function sessionTitleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "新对话";
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

function normalizeWritingHabitMode(raw: Partial<HomeComposerPrefs>): WritingHabitMode {
  if (
    raw.writingHabitMode === "neutral" ||
    raw.writingHabitMode === "notebook" ||
    raw.writingHabitMode === "template" ||
    raw.writingHabitMode === "off"
  ) {
    return raw.writingHabitMode;
  }
  if (raw.styleTemplateId) return "template";
  if (raw.notebook?.trim()) return "notebook";
  return "neutral";
}

function normalizeExpert(raw: Partial<HomeComposerPrefs>): ComposerExpertSelection {
  if (raw.expert?.mode === "platform" || raw.expert?.mode === "none") return raw.expert;
  const legacyFormats = Array.isArray(raw.formats)
    ? (raw.formats.filter(Boolean) as HomeComposerFormat[])
    : [];
  return expertSelectionFromLegacyFormats(legacyFormats);
}

export function normalizeHomeComposerPrefs(raw: Partial<HomeComposerPrefs> | undefined): HomeComposerPrefs {
  const base = defaultHomeComposerPrefs();
  if (!raw || typeof raw !== "object") return base;

  const personalProfile = raw.personalProfile ?? base.personalProfile;
  const featureCore = backfillFeatureCoreFromProfile(raw.featureCore ?? base.featureCore, personalProfile);

  return {
    ...base,
    ...raw,
    formats: Array.isArray(raw.formats) ? (raw.formats.filter(Boolean) as HomeComposerFormat[]) : [],
    expert: normalizeExpert(raw),
    notebook: String(raw.notebook || ""),
    noteIds: Array.isArray(raw.noteIds) ? raw.noteIds.map(String) : [],
    styleTemplateId: raw.styleTemplateId ?? null,
    writingHabitMode: normalizeWritingHabitMode(raw),
    personalEnabled: Boolean(raw.personalEnabled),
    personalProfile,
    featureCore,
    personalDisabledByUser: raw.personalDisabledByUser,
    personalFeaturePreferences: raw.personalFeaturePreferences ?? base.personalFeaturePreferences,
    taskDraft: raw.taskDraft,
    lastDeliverableId: raw.lastDeliverableId
  };
}

function normalizeSession(raw: unknown): HomeComposerSession | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<HomeComposerSession>;
  if (!row.id || typeof row.id !== "string") return null;
  return {
    id: row.id,
    title: String(row.title || "新对话"),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    prefs: normalizeHomeComposerPrefs(row.prefs),
    sessionState: row.sessionState ?? null,
    turns: Array.isArray(row.turns) ? row.turns : []
  };
}

export function normalizeHomeComposerStore(raw: unknown): HomeComposerStore {
  if (!raw || typeof raw !== "object") {
    const session = createSession();
    return { v: 2, activeSessionId: session.id, sessions: [session] };
  }
  const row = raw as Partial<HomeComposerStore>;
  const sessions = Array.isArray(row.sessions)
    ? (row.sessions.map(normalizeSession).filter(Boolean) as HomeComposerSession[])
    : [];
  if (!sessions.length) {
    const session = createSession();
    return { v: 2, activeSessionId: session.id, sessions: [session] };
  }
  const active =
    String(row.activeSessionId || "").trim() && sessions.some((s) => s.id === row.activeSessionId)
      ? String(row.activeSessionId)
      : sessions[0]!.id;
  return { v: 2, activeSessionId: active, sessions: sessions.slice(0, MAX_SESSIONS) };
}

function createSession(prefs?: Partial<HomeComposerPrefs>): HomeComposerSession {
  const id = newSessionId();
  return {
    id,
    title: "新对话",
    updatedAt: Date.now(),
    prefs: normalizeHomeComposerPrefs(prefs),
    sessionState: EMPTY_NOTES_ASK_SESSION_STATE(),
    turns: []
  };
}

export function loadHomeComposerStore(): HomeComposerStore {
  try {
    const raw = readLocalStorageScoped(STORAGE_KEY);
    if (!raw) {
      const session = createSession();
      return { v: 2, activeSessionId: session.id, sessions: [session] };
    }
    return normalizeHomeComposerStore(JSON.parse(raw));
  } catch {
    const session = createSession();
    return { v: 2, activeSessionId: session.id, sessions: [session] };
  }
}

export function saveHomeComposerStore(store: HomeComposerStore): void {
  writeLocalStorageScoped(STORAGE_KEY, JSON.stringify({ ...store, v: 2 }));
}

export function upsertHomeComposerSession(
  store: HomeComposerStore,
  session: HomeComposerSession
): HomeComposerStore {
  const sessions = [session, ...store.sessions.filter((s) => s.id !== session.id)].slice(0, MAX_SESSIONS);
  return { ...store, v: 2, sessions, activeSessionId: session.id };
}

export function patchActiveHomeComposerSession(
  store: HomeComposerStore,
  patch: Partial<HomeComposerSession> | ((session: HomeComposerSession) => HomeComposerSession)
): HomeComposerStore {
  const activeId = store.activeSessionId;
  const sessions = store.sessions.map((s) => {
    if (s.id !== activeId) return s;
    const next = typeof patch === "function" ? patch(s) : { ...s, ...patch, updatedAt: Date.now() };
    return { ...next, updatedAt: Date.now(), prefs: normalizeHomeComposerPrefs(next.prefs) };
  });
  return { ...store, v: 2, sessions };
}

export function createHomeComposerSession(store: HomeComposerStore, inheritPrefs?: HomeComposerPrefs): HomeComposerStore {
  const active = activeHomeComposerSession(store);
  if (active && active.turns.length === 0) {
    return store;
  }
  const session = createSession(
    inheritPrefs
      ? {
          ...inheritPrefs,
          formats: [],
          taskDraft: undefined
        }
      : undefined
  );
  return upsertHomeComposerSession(store, session);
}

export function selectHomeComposerSession(store: HomeComposerStore, sessionId: string): HomeComposerStore {
  if (!store.sessions.some((s) => s.id === sessionId)) return store;
  return { ...store, activeSessionId: sessionId };
}

/** 删除会话；若删的是最后一条则新建空会话。 */
export function deleteHomeComposerSession(store: HomeComposerStore, sessionId: string): HomeComposerStore {
  const remaining = store.sessions.filter((s) => s.id !== sessionId);
  if (!remaining.length) {
    const session = createSession();
    return { v: 2, activeSessionId: session.id, sessions: [session] };
  }
  const activeSessionId =
    store.activeSessionId === sessionId ? remaining[0]!.id : store.activeSessionId;
  return { ...store, activeSessionId, sessions: remaining };
}

export function appendHomeComposerTurn(
  store: HomeComposerStore,
  turn: HomeComposerTurn,
  opts?: { replaceLast?: boolean }
): HomeComposerStore {
  return patchActiveHomeComposerSession(store, (session) => {
    const turns = opts?.replaceLast
      ? [...session.turns.slice(0, -1), turn]
      : [...session.turns, turn];
    return {
      ...session,
      title: session.turns.length ? session.title : sessionTitleFromText(turn.userText),
      turns
    };
  });
}

export function updateHomeComposerTurn(
  store: HomeComposerStore,
  turnId: string,
  patch: Partial<HomeComposerTurn> | ((turn: HomeComposerTurn) => HomeComposerTurn)
): HomeComposerStore {
  return patchActiveHomeComposerSession(store, (session) => ({
    ...session,
    turns: session.turns.map((t) => {
      if (t.id !== turnId) return t;
      return typeof patch === "function" ? patch(t) : { ...t, ...patch };
    })
  }));
}

export function activeHomeComposerSession(store: HomeComposerStore): HomeComposerSession | null {
  return store.sessions.find((s) => s.id === store.activeSessionId) ?? store.sessions[0] ?? null;
}

/** 进入对话页：载入本地历史；若当前会话已有内容则新建空会话（继承偏好，格式清空）。 */
export function openHomeComposerOnPageEntry(): HomeComposerStore {
  const loaded = loadHomeComposerStore();
  const active = activeHomeComposerSession(loaded);
  if (active && active.turns.length === 0) {
    return loaded;
  }
  return createHomeComposerSession(loaded, active?.prefs);
}
