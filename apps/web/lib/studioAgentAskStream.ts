import type { NotesAskMemoryTurn, NotesAskSessionState } from "./notesAskMemoryTypes";
import { updateNotesAskSessionState } from "./notesAskSessionState";
import {
  streamHomeComposerAsk,
  type HomeComposerAskCallbacks,
  type HomeComposerAskDone
} from "./homeComposerAskStream";
import { buildStudioStructuredOutputPrompt, parseStudioAgentStructuredResponse } from "./studioAgentStructured";
import type { StudioWork } from "./studioWorkTypes";

export type StudioAgentAskDone = HomeComposerAskDone & {
  structured: ReturnType<typeof parseStudioAgentStructuredResponse>;
  displayText: string;
  sources?: HomeComposerAskDone["sources"];
};

/** Studio 专用 ask：强制 JSON 结构化输出，silent 时不占位助手消息 */
export async function streamStudioAgentAsk(params: {
  work: StudioWork;
  question: string;
  mode: "general" | "rag";
  notebook?: string;
  noteIds?: string[];
  memoryTurns: NotesAskMemoryTurn[];
  sessionState: NotesAskSessionState | null;
  dialogueStylePrompt?: string;
  authorIpPrompt?: string;
  authHeaders: Record<string, string>;
  signal?: AbortSignal;
  callbacks?: HomeComposerAskCallbacks;
}): Promise<StudioAgentAskDone> {
  const structuredBlock = buildStudioStructuredOutputPrompt(params.work);
  const ragBase = (params.dialogueStylePrompt || "").trim();
  const ragRoom = Math.max(0, 4000 - structuredBlock.length - 4);
  const generalBase = (params.authorIpPrompt || "").trim();
  const generalRoom = Math.max(0, 8000 - structuredBlock.length - 4);

  const done = await streamHomeComposerAsk({
    question: params.question,
    mode: params.mode,
    notebook: params.notebook,
    noteIds: params.noteIds,
    memoryTurns: params.memoryTurns,
    sessionState: params.sessionState,
    dialogueStylePrompt:
      params.mode === "rag"
        ? [ragBase.slice(0, ragRoom), structuredBlock].filter(Boolean).join("\n\n")
        : params.dialogueStylePrompt,
    authorIpPrompt:
      params.mode === "general"
        ? [generalBase.slice(0, generalRoom), structuredBlock].filter(Boolean).join("\n\n")
        : params.authorIpPrompt,
    authHeaders: params.authHeaders,
    signal: params.signal,
    allowEmptyAnswer: true,
    callbacks: params.callbacks
  });

  const raw =
    done.answer.trim() || String(done.supplementAnswer || "").trim();
  const structured = parseStudioAgentStructuredResponse(raw);
  const displayText =
    structured.kind === "reply"
      ? structured.text
      : structured.kind === "ask_user"
        ? structured.question
        : "";

  let sessionState = done.sessionState;
  if (structured.kind === "silent") {
    sessionState = updateNotesAskSessionState(
      params.sessionState,
      [...params.memoryTurns, { id: "u", role: "user", content: params.question.trim() }],
      params.question.trim(),
      ""
    );
  } else if (displayText) {
    sessionState = updateNotesAskSessionState(
      params.sessionState,
      [
        ...params.memoryTurns,
        { id: "u", role: "user", content: params.question.trim() },
        { id: "a", role: "assistant", content: displayText }
      ],
      params.question.trim(),
      displayText
    );
  }

  return {
    ...done,
    answer: raw,
    sessionState,
    structured,
    displayText,
    sources: done.sources
  };
}
