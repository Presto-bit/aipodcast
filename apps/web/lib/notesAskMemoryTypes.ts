/** 知识库对话记忆（无 UI）：路由锚点、会话态、API 打包类型 */

export type NotesAskRouteChapter = {
  noteId: string;
  chapterId: string;
  title?: string;
};

export type NotesAskRouteShard = {
  noteId: string;
  shardId: string;
  title?: string;
};

export type NotesAskSessionThread = {
  id: string;
  about: string;
  status: "active" | "parked";
};

export type NotesAskSessionState = {
  v: 1;
  topic: string;
  threads: NotesAskSessionThread[];
  facts: string[];
  prefs: string[];
  turnCursor: number;
  sourcesRevision?: number;
};

export type NotesAskMemoryTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  activeChapters?: NotesAskRouteChapter[];
  activeShards?: NotesAskRouteShard[];
  threadId?: string;
};

export type PackedNotesAskChatRow = {
  role: "user" | "assistant";
  content: string;
  activeChapters?: NotesAskRouteChapter[];
  activeShards?: NotesAskRouteShard[];
  threadId?: string;
};

export type PackNotesAskMemoryResult = {
  chatHistory: PackedNotesAskChatRow[];
  sessionState: NotesAskSessionState | null;
};

export const EMPTY_NOTES_ASK_SESSION_STATE = (): NotesAskSessionState => ({
  v: 1,
  topic: "",
  threads: [],
  facts: [],
  prefs: [],
  turnCursor: 0
});
