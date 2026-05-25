import { buildNotesAskAnswerBody } from "./notesAskAnswerNormalize";
import type { SocialPublishSourceCandidate } from "./socialPublishTypes";

export function lastAssistantAnswerText(
  messages: Array<{ role: string; content: string; supplementContent?: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const body = buildNotesAskAnswerBody(m.content, m.supplementContent);
    if (body.trim().length >= 40) return body.trim();
  }
  return "";
}

export function buildSocialPublishSourceCandidates(params: {
  noteIds: string[];
  askMessages: Array<{ role: string; content: string; supplementContent?: string }>;
}): SocialPublishSourceCandidate[] {
  const out: SocialPublishSourceCandidate[] = [];
  const n = params.noteIds.length;

  if (n > 0) {
    out.push({
      key: "notes_only",
      type: "notes_only",
      label: n === 1 ? "勾选的资料" : `勾选的资料（${n} 篇）`,
      materialPreview: "根据当前勾选的参考资料改写",
      materialText: "",
      recommended: true
    });
  }

  const ask = lastAssistantAnswerText(params.askMessages);
  if (ask.length >= 40) {
    out.push({
      key: "ask_answer",
      type: "ask_answer",
      label: "刚才的对话回答",
      materialPreview: ask.slice(0, 120) + (ask.length > 120 ? "…" : ""),
      materialText: ask,
      recommended: false
    });
  }

  return out;
}

export async function resolveSourceMaterial(params: {
  source: SocialPublishSourceCandidate;
  authHeaders: Record<string, string>;
  noteIds: string[];
}): Promise<string> {
  if (params.source.type === "ask_answer") {
    const text = params.source.materialText.trim();
    if (text.length >= 40) return text.slice(0, 48_000);
    throw new Error("对话回答过短，请先向资料提问或改用「勾选的资料」");
  }

  const chunks: string[] = [];
  for (const nid of params.noteIds.slice(0, 5)) {
    const res = await fetch(
      `/api/notes/${encodeURIComponent(nid)}/preview_text?max_chars=4000`,
      { credentials: "same-origin", cache: "no-store", headers: { ...params.authHeaders } }
    );
    const data = (await res.json().catch(() => ({}))) as { text?: string; filtered_text?: string };
    const t = String(data.filtered_text || data.text || "").trim();
    if (t) chunks.push(t);
  }
  const merged = chunks.join("\n\n").trim();
  if (merged.length < 40) {
    throw new Error("勾选资料过短，请补充资料内容或先向资料提问后再发布");
  }
  return merged.slice(0, 48_000);
}
