import type { StudioWork } from "./studioWorkTypes";

/** Studio 对话区 ask：Cursor 式结构化收尾（仅 JSON，无自由附言） */
export const STUDIO_STRUCTURED_OUTPUT_ENABLED = true;

export type StudioAgentResponseKind = "silent" | "reply" | "ask_user";

export type StudioAgentStructuredResponse =
  | { kind: "silent" }
  | { kind: "reply"; text: string }
  | { kind: "ask_user"; question: string };

export function buildStudioStructuredOutputPrompt(work: StudioWork): string {
  const ready = work.status === "ready" || work.status === "shipped";
  return [
    "【输出格式 · 必须遵守】",
    "你只输出一个 JSON 对象，不要 markdown 代码围栏，不要 JSON 前后的说明文字。首字符必须是 { ，末字符必须是 } 。",
    "",
    '结构：',
    '{"kind":"silent"} — 无需再对用户说任何话（任务已完成、用户未提出新问题、或信息已足够可执行）。',
    '{"kind":"reply","text":"..."} — 直接回答用户当前问题（Markdown 写在 text 内）。',
    '{"kind":"ask_user","question":"..."} — 仅缺 blocking 信息、必须先问清才能继续时；question 为一句具体追问。',
    "",
    "规则：",
    "- 一次最多一个 ask_user 问题，禁止连环追问。",
    "- 禁止「刚看完你这篇」「最好的一点是」等旁观者点评口吻。",
    "- text / question 内勿重复粘贴完整稿件全文。",
    ready
      ? "- 稿件已在产物区：用户未明确提问时用 silent；不要主动点评或建议下一步。"
      : "- 任务要点已清楚、可确认写稿时：用 reply 简短提示用户回复「确认任务」，勿长篇追问。"
  ].join("\n");
}

export function extractStudioAgentJsonBlob(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

export function parseStudioAgentStructuredResponse(raw: string): StudioAgentStructuredResponse {
  const jsonStr = extractStudioAgentJsonBlob(raw);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const kind = String(parsed.kind || "").trim();
      if (kind === "silent") return { kind: "silent" };
      if (kind === "ask_user") {
        const question = String(parsed.question ?? "").trim();
        if (question) return { kind: "ask_user", question };
      }
      if (kind === "reply") {
        const text = String(parsed.text ?? "").trim();
        if (text) return { kind: "reply", text };
      }
    } catch {
      // fall through
    }
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.includes("\"kind\"")) {
    return { kind: "silent" };
  }
  if (trimmed) return { kind: "reply", text: trimmed };
  return { kind: "silent" };
}

/** 结构化结果 → 对话区展示文案；silent 返回空串 */
export function studioStructuredToDisplayText(res: StudioAgentStructuredResponse): string {
  if (res.kind === "reply") return res.text;
  if (res.kind === "ask_user") return res.question;
  return "";
}

export function studioStructuredAddsAssistantTurn(res: StudioAgentStructuredResponse): boolean {
  return res.kind !== "silent";
}
