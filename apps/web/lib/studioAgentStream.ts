import { normalizeStreamManuscriptBlocks } from "./studioManuscriptStream";
import type { ManuscriptBlock, StudioAgentTurn, WorkStatus } from "./studioWorkTypes";

export type StudioAgentTool = "reply" | "compose" | "revise";

export type StudioAgentStreamInput = {
  message: string;
  agentTurns: StudioAgentTurn[];
  status: WorkStatus;
  versionCount: number;
  taskSentence: string;
  intake: Record<string, string | string[]>;
  notebook: string;
  noteIds: string[];
  featureCore?: Record<string, unknown>;
  authorPrompt?: string;
  stylePrompt?: string;
  authHeaders: Record<string, string>;
  signal?: AbortSignal;
  onSession?: (requestId: string) => void;
  onReply?: (text: string) => void;
  onPhase?: (message: string, tool: StudioAgentTool) => void;
  onBlockDelta?: (blocks: ManuscriptBlock[], tool: StudioAgentTool) => void;
};

export type StudioAgentStreamResult =
  | { status: "reply"; text: string }
  | { status: "done"; tool: "compose" | "revise"; blocks: ManuscriptBlock[] }
  | { status: "error"; error: string }
  | { status: "aborted" };

export async function streamStudioAgent(
  input: StudioAgentStreamInput
): Promise<StudioAgentStreamResult> {
  const res = await fetch("/api/studio/agent/stream", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...input.authHeaders
    },
    body: JSON.stringify({
      message: input.message.trim(),
      agentTurns: input.agentTurns.map((t) => ({
        role: t.role,
        content: t.content
      })),
      status: input.status,
      versionCount: input.versionCount,
      taskSentence: input.taskSentence.trim(),
      intake: input.intake,
      notebook: input.notebook.trim(),
      noteIds: input.noteIds,
      featureCore: input.featureCore ?? {},
      authorPrompt: input.authorPrompt?.trim() || "",
      stylePrompt: input.stylePrompt?.trim() || "",
      useRag: input.noteIds.length > 0,
      sourceType: input.noteIds.length > 0 ? "notes_rag" : "composer_prompt"
    }),
    signal: input.signal
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = String(data.detail || data.error || data.message || `HTTP ${res.status}`).trim();
    return { status: "error", error: msg || "Agent 请求失败" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let replyText = "";
  let doneTool: "compose" | "revise" | null = null;
  let doneBlocks: ManuscriptBlock[] = [];
  let firstDeltaAt = 0;
  const startedAt = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
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
        const tool = String(ev.tool || "") as StudioAgentTool;

        if (type === "session") {
          const rid = String(ev.requestId || "").trim();
          if (rid) input.onSession?.(rid);
        } else if (type === "reply") {
          replyText = String(ev.text || "").trim();
          if (replyText) input.onReply?.(replyText);
        } else if (type === "phase") {
          const msg = String(ev.message || "").trim();
          if (msg) input.onPhase?.(msg, tool === "revise" ? "revise" : "compose");
        } else if (type === "block_delta") {
          if (!firstDeltaAt) firstDeltaAt = Date.now();
          const blocks = normalizeStreamManuscriptBlocks(ev.blocks);
          if (blocks.length) {
            input.onBlockDelta?.(blocks, tool === "revise" ? "revise" : "compose");
          }
        } else if (type === "done") {
          const dt = String(ev.tool || "");
          if (dt === "reply") {
            return { status: "reply", text: replyText || "好的。" };
          }
          doneTool = dt === "revise" ? "revise" : "compose";
          doneBlocks = normalizeStreamManuscriptBlocks(ev.blocks);
        } else if (type === "error") {
          return { status: "error", error: String(ev.message || "生成失败") };
        }
      }
    }
  }

  if (input.signal?.aborted) {
    return { status: "aborted" };
  }

  if (replyText && !doneTool) {
    return { status: "reply", text: replyText };
  }

  if (doneTool && doneBlocks.length) {
    if (!firstDeltaAt && Date.now() - startedAt > 8000) {
      return { status: "error", error: "生成超时：8 秒内未收到稿件更新" };
    }
    return { status: "done", tool: doneTool, blocks: doneBlocks };
  }

  return { status: "error", error: "Agent 未返回完整结果" };
}
