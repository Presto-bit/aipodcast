import type { ExpertDeliverable } from "./homeComposerExpertTypes";
import { parseExpertDeliverable, validateExpertDeliverable } from "./validateExpertDeliverable";
import type { ManuscriptBlock } from "./studioWorkTypes";

/** 将 SSE partial blocks 规范为 ManuscriptBlock（服务端已对齐，此处做类型守卫） */
export function normalizeStreamManuscriptBlocks(raw: unknown): ManuscriptBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ManuscriptBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = String(row.kind || "").trim();
    const id = String(row.id || "").trim() || crypto.randomUUID();
    if (kind === "title") {
      const text = String(row.text || "").trim();
      if (text) out.push({ id, kind: "title", text, evidence: "model" });
    } else if (kind === "body") {
      const text = String(row.text || "").trim();
      if (text) out.push({ id, kind: "body", text, evidence: "model" });
    } else if (kind === "hashtags") {
      const tags = Array.isArray(row.tags)
        ? row.tags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean)
        : [];
      if (tags.length) out.push({ id, kind: "hashtags", tags });
    } else if (kind === "coverBrief") {
      const text = String(row.text || "").trim();
      if (text) out.push({ id, kind: "coverBrief", text });
    }
  }
  return out;
}

export type StudioManuscriptStreamInput = {
  taskSentence: string;
  intake: Record<string, string | string[]>;
  notebook: string;
  noteIds: string[];
  featureCore?: Record<string, unknown>;
  authorPrompt?: string;
  stylePrompt?: string;
  authHeaders: Record<string, string>;
  signal?: AbortSignal;
  onPhase?: (message: string) => void;
  onBlocks?: (blocks: ManuscriptBlock[]) => void;
};

export type StudioManuscriptStreamResult =
  | { status: "done"; deliverable: ExpertDeliverable }
  | { status: "error"; error: string };

export async function streamStudioManuscript(
  input: StudioManuscriptStreamInput
): Promise<StudioManuscriptStreamResult> {
  const res = await fetch("/api/studio/manuscript/stream", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...input.authHeaders
    },
    body: JSON.stringify({
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
    return { status: "error", error: msg || "流式成稿请求失败" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let deliverable: ExpertDeliverable | null = null;

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
        if (type === "phase") {
          const msg = String(ev.message || "").trim();
          if (msg) input.onPhase?.(msg);
        } else if (type === "blocks") {
          const blocks = normalizeStreamManuscriptBlocks(ev.blocks);
          if (blocks.length) input.onBlocks?.(blocks);
        } else if (type === "done") {
          const rawDel = ev.deliverable;
          if (rawDel && typeof rawDel === "object") {
            deliverable = rawDel as ExpertDeliverable;
          }
        } else if (type === "error") {
          return { status: "error", error: String(ev.message || "生成失败") };
        }
      }
    }
  }

  if (!deliverable) {
    return { status: "error", error: "流式成稿未返回完整结果" };
  }
  const check = validateExpertDeliverable(deliverable);
  if (!check.ok) {
    return { status: "error", error: check.errors.join("；") };
  }
  const parsed = parseExpertDeliverable(deliverable);
  if (!parsed) {
    return { status: "error", error: "deliverable 解析失败" };
  }
  return { status: "done", deliverable: parsed };
}
