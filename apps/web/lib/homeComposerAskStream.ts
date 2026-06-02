import { formatNotesAskStreamError } from "./apiError";
import { packNotesAskMemory } from "./notesAskMemoryPack";
import type { NotesAskMemoryTurn, NotesAskSessionState } from "./notesAskMemoryTypes";
import { notesAskBffUrl, notesAskFetchCredentials } from "./notesAskBffOrigin";
import { updateNotesAskSessionState } from "./notesAskSessionState";

export type HomeComposerAskDone = {
  answer: string;
  supplementAnswer?: string;
  sessionState: NotesAskSessionState | null;
  qaMode?: string;
};

export type HomeComposerAskCallbacks = {
  onPhase?: (message: string) => void;
  onChunk?: (text: string, role: "answer" | "reasoning", section: "corpus" | "supplement") => void;
};

function notesAskClientRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `na-${Date.now().toString(36)}`;
}

function phaseUserMessage(phase?: string, message?: string, mode?: "general" | "rag"): string {
  const msg = String(message || "").trim();
  if (mode === "general") {
    if (phase === "thinking" || msg.includes("整理对话")) return "正在整理上下文…";
    if (phase === "answering" || msg.includes("资料已就绪") || msg.includes("生成回答")) {
      return "正在生成回答…";
    }
    if (msg && !msg.includes("排队")) return msg;
    return phase === "retrieving" ? "正在整理上下文…" : "正在生成回答…";
  }
  if (msg) return msg;
  if (phase === "retrieving") return "正在检索资料…";
  if (phase === "thinking") return "正在整理上下文…";
  if (phase === "answering") return "正在生成回答…";
  if (phase === "supplement_start") return "正在补充通识参考…";
  return "";
}

function isDismissedSupplement(text: string): boolean {
  const t = text.trim();
  return !t || t === "（无）" || t === "无";
}

export async function streamHomeComposerAsk(params: {
  question: string;
  mode: "general" | "rag";
  notebook?: string;
  noteIds?: string[];
  memoryTurns: NotesAskMemoryTurn[];
  sessionState: NotesAskSessionState | null;
  globalStylePrompt?: string;
  authorIpPrompt?: string;
  dialogueStylePrompt?: string;
  authHeaders: Record<string, string>;
  signal?: AbortSignal;
  callbacks?: HomeComposerAskCallbacks;
}): Promise<HomeComposerAskDone> {
  const q = params.question.trim();
  if (!q) throw new Error("请输入内容");

  const memoryPacked = packNotesAskMemory(params.memoryTurns, params.sessionState);
  const streamRid = notesAskClientRequestId();
  const body: Record<string, unknown> = {
    mode: params.mode,
    question: q,
    chatHistory: memoryPacked.chatHistory,
    ...(memoryPacked.sessionState ? { sessionState: memoryPacked.sessionState } : {})
  };

  if (params.mode === "rag") {
    body.notebook = String(params.notebook || "").trim();
    body.note_ids = params.noteIds || [];
    if (params.dialogueStylePrompt?.trim()) {
      body.dialogueStylePrompt = params.dialogueStylePrompt.trim();
    }
  } else {
    if (params.globalStylePrompt?.trim()) {
      body.globalStylePrompt = params.globalStylePrompt.trim();
    }
    if (params.authorIpPrompt?.trim()) {
      body.authorIpPrompt = params.authorIpPrompt.trim();
    }
    if (params.dialogueStylePrompt?.trim()) {
      body.dialogueStylePrompt = params.dialogueStylePrompt.trim();
    }
  }

  const res = await fetch(notesAskBffUrl("/api/notes/ask/stream"), {
    method: "POST",
    credentials: notesAskFetchCredentials(),
    signal: params.signal,
    headers: {
      "content-type": "application/json",
      "x-request-id": streamRid,
      ...params.authHeaders
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const rawText = await res.text();
    let detail = rawText.trim();
    try {
      const data = JSON.parse(rawText) as { detail?: unknown; error?: string };
      detail = String(data.detail || data.error || detail);
    } catch {
      // keep raw
    }
    throw new Error(detail || `问答失败（HTTP ${res.status}）`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("流式响应不可用");

  const decoder = new TextDecoder();
  let buffer = "";
  let answerAcc = "";
  let supplementAcc = "";
  let doneAnswer = "";
  let doneSupplement = "";
  let doneSessionState = params.sessionState;
  let qaMode: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const block of parts) {
      for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = String(ev.type || "");
        if (type === "phase") {
          const msg = phaseUserMessage(String(ev.phase || ""), String(ev.message || ""), params.mode);
          if (msg) params.callbacks?.onPhase?.(msg);
        } else if (type === "chunk") {
          const text = String(ev.text ?? "");
          if (!text) continue;
          const streamRole = String(ev.streamRole || "answer") === "reasoning" ? "reasoning" : "answer";
          const section = String(ev.section || "") === "supplement" ? "supplement" : "corpus";
          if (streamRole === "answer") {
            if (section === "supplement") supplementAcc += text;
            else answerAcc += text;
          }
          params.callbacks?.onChunk?.(text, streamRole, section);
        } else if (type === "done") {
          doneAnswer = String(ev.answer ?? answerAcc).trim() || answerAcc.trim();
          const supRaw = String(ev.supplementAnswer ?? supplementAcc).trim();
          doneSupplement = isDismissedSupplement(supRaw) ? "" : supRaw || supplementAcc.trim();
          qaMode = ev.qaMode ? String(ev.qaMode) : undefined;
          doneSessionState = updateNotesAskSessionState(
            params.sessionState,
            [
              ...params.memoryTurns,
              { id: "u", role: "user", content: q },
              { id: "a", role: "assistant", content: doneAnswer }
            ],
            q,
            doneAnswer
          );
        } else if (type === "error") {
          throw new Error(
            formatNotesAskStreamError(String(ev.message || "").trim() || "问答失败", {
              code: ev.code ? String(ev.code) : undefined,
              detail: ev.detail ? String(ev.detail) : undefined,
              requestId: ev.requestId ? String(ev.requestId) : undefined,
              textProvider: ev.textProvider ? String(ev.textProvider) : undefined,
              hint: ev.hint ? String(ev.hint) : undefined
            })
          );
        }
      }
    }
  }

  const answer = doneAnswer || answerAcc.trim();
  if (!answer) throw new Error("模型未返回有效正文，请稍后重试");

  return {
    answer,
    supplementAnswer: doneSupplement || undefined,
    sessionState: doneSessionState,
    qaMode
  };
}

export function homeComposerTurnsToMemoryTurns(
  turns: { id: string; userText: string; general?: { content: string } }[]
): NotesAskMemoryTurn[] {
  const out: NotesAskMemoryTurn[] = [];
  for (const turn of turns) {
    const u = turn.userText.trim();
    if (u) out.push({ id: `${turn.id}-u`, role: "user", content: u });
    const a = turn.general?.content?.trim();
    if (a) out.push({ id: `${turn.id}-a`, role: "assistant", content: a });
  }
  return out;
}
