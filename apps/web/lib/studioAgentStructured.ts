import { isOpsStrategyQuestion, opsStrategyFallbackReply, STUDIO_OPS_WITH_MANUSCRIPT_CHIPS } from "./studioOpsStrategy";
import { STUDIO_OPS_FOLLOWUP_CHIPS } from "./studioBriefMerge";
import { wouldAutoGenerate } from "./studioOrchestrator";
import { composeTaskSentenceFromTurns, taskSentenceFromWork } from "./studioWorkTask";
import { isDraftLikeStatus } from "./studioWorkMigrate";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";

function lastClarifyAssistant(turns: StudioAgentTurn[]): StudioAgentTurn | undefined {
  return [...turns]
    .reverse()
    .find(
      (t) =>
        t.role === "assistant" &&
        (t.intent === "brief_clarify" || t.intent === "compose_rewrite")
    );
}

export function userMessageLooksLikeQuestion(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return /[?？]$|怎么|如何|为什么|为啥|什么|多少|是否|吗$/.test(q);
}

/** 成稿后：非纯问句的 reply 不插入气泡（P2：改稿指令应走 canvas，不走 coach） */
export function shouldSuppressStudioCanvasReply(work: StudioWork, userMessage: string): boolean {
  const ready = work.status === "ready" || work.status === "shipped";
  if (!ready || work.versions.length === 0) return false;
  const q = userMessage.trim();
  if (!q) return true;
  if (!userMessageLooksLikeQuestion(q)) return true;
  return /怎么|如何|为什么|为啥|是否|能不能|可以吗/.test(q) === false;
}

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
    '{"kind":"ask_user","question":"..."} — 仅完全无法开工的 blocking 缺口（如无主题且无形式）；question 为一句具体追问。',
    "",
    "规则：",
    "- 默认 silent：用户已描述想写什么、形式或受众任一项时，勿 ask_user 追问细节，由写稿自行合理假设。",
    "- 一次最多一个 ask_user，禁止连环追问；禁止问语气/篇幅/钩子等非 blocking 项。",
    "- 禁止「刚看完你这篇」「最好的一点是」等旁观者点评口吻。",
    "- text / question 内勿重复粘贴完整稿件全文。",
    "- 用户问运营/发布/推广/什么时候发/怎么推：必须用 reply 给分点建议，禁止 ask_user 要求提供画布或稿件主题。",
    ready
      ? "- 稿件已在产物区：用户未明确提问时用 silent；不要主动点评或建议下一步。"
      : "- 仅当用户既无主题又无形式且整句极短（约 8 字内）时用 ask_user；有 open-ended 写稿意图时 silent 并交由写稿执行；用户明确提问用 reply 简答。"
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

/**
 * 草稿态：仅当编排会 auto-generate 时，才把 ask_user 降为 silent；
 * 信息不足走 ask 时须保留追问。
 */
export function resolveStudioStructuredResponse(
  work: StudioWork,
  structured: StudioAgentStructuredResponse,
  latestUserMessage?: string
): StudioAgentStructuredResponse {
  const q = latestUserMessage?.trim() ?? "";
  const noManuscript = work.versions.length === 0;

  if (q && isOpsStrategyQuestion(q) && noManuscript) {
    if (structured.kind === "ask_user") {
      return { kind: "reply", text: opsStrategyFallbackReply(q, taskSentenceFromWork(work)) };
    }
    if (structured.kind === "silent") {
      return { kind: "reply", text: opsStrategyFallbackReply(q, taskSentenceFromWork(work)) };
    }
    if (structured.kind === "reply" && /画布|稿件的主题|内容方向/.test(structured.text)) {
      return { kind: "reply", text: opsStrategyFallbackReply(q, taskSentenceFromWork(work)) };
    }
  }

  const ready = work.status === "ready" || work.status === "shipped";
  if (ready && structured.kind === "reply" && q && !userMessageLooksLikeQuestion(q) && q.length < 16) {
    return { kind: "silent" };
  }

  if (structured.kind !== "ask_user") return structured;
  if (!isDraftLikeStatus(work.status)) return structured;
  if (!q) return structured;
  return { kind: "silent" };
}

/** 运营回复后附带的 Cursor 式下一步 chips */
export function opsStrategySuggestedReplies(work: StudioWork): string[] | undefined {
  if (work.versions.length > 0) {
    return [...STUDIO_OPS_WITH_MANUSCRIPT_CHIPS];
  }
  return [...STUDIO_OPS_FOLLOWUP_CHIPS];
}

/** 信息不足且模型返回 silent 时，给用户可见的兜底追问 */
export function draftAskFallbackText(
  work: StudioWork,
  latestUserMessage: string,
  rawAnswer?: string,
  turns?: StudioAgentTurn[]
): string | null {
  const turnList = turns ?? work.agentTurns;
  const composeTask = composeTaskSentenceFromTurns(turnList, latestUserMessage);

  if (lastClarifyAssistant(turnList)) {
    return null;
  }

  if (isOpsStrategyQuestion(latestUserMessage) && work.versions.length === 0) {
    const trimmed = rawAnswer?.trim();
    if (trimmed && !trimmed.startsWith("{") && !/画布|稿件的主题|内容方向/.test(trimmed)) {
      return trimmed;
    }
    return opsStrategyFallbackReply(latestUserMessage, taskSentenceFromWork(work));
  }
  if (!isDraftLikeStatus(work.status)) return null;
  if (wouldAutoGenerate(work, latestUserMessage, turnList)) return null;
  const trimmed = rawAnswer?.trim();
  if (trimmed && !trimmed.startsWith("{")) return trimmed;
  return null;
}
