import { streamHomeComposerAsk } from "./homeComposerAskStream";
import { extractStudioAgentJsonBlob } from "./studioAgentStructured";

const TITLE_MIN = 4;
const TITLE_MAX = 24;

/** 同步占位：小红书 · 主题截断（LLM 返回前侧栏可读） */
export function fallbackStudioWorkTitle(taskSentence: string): string {
  const t = taskSentence.trim().replace(/\s+/g, " ");
  if (!t) return "新任务";
  const clip = t
    .replace(/[。！？!?\n,，;；]+/g, " ")
    .trim()
    .slice(0, 18);
  return clip.length >= TITLE_MIN ? `小红书 · ${clip}` : "新任务";
}

function normalizeTitleText(raw: string): string | null {
  const t = raw.trim().replace(/^["'「『]|["'」』]$/g, "").replace(/\s+/g, " ");
  if (t.length < TITLE_MIN || t.length > TITLE_MAX) return null;
  if (/^新任务$/i.test(t)) return null;
  return t;
}

function parseTitleFromLlmAnswer(answer: string): string | null {
  const jsonStr = extractStudioAgentJsonBlob(answer);
  if (jsonStr) {
    try {
      const o = JSON.parse(jsonStr) as { title?: string };
      const fromJson = normalizeTitleText(String(o.title ?? ""));
      if (fromJson) return fromJson;
    } catch {
      // fall through
    }
  }
  const line = answer.trim().split("\n").find((l) => l.trim())?.trim() ?? "";
  return normalizeTitleText(line);
}

/**
 * 方案 A：根据首条用户需求异步生成 12～20 字任务名（不阻塞输入）。
 * 失败时保留 fallback 标题。
 */
export async function suggestStudioWorkTitleLlm(
  taskSentence: string,
  authHeaders: Record<string, string>,
  signal?: AbortSignal
): Promise<string | null> {
  const q = taskSentence.trim().slice(0, 500);
  if (q.length < TITLE_MIN) return null;

  const done = await streamHomeComposerAsk({
    question: [
      "请为以下创作需求起一个简短任务名（12～20 字），概括要写什么。",
      "只输出 JSON：{\"title\":\"任务名\"}，不要 markdown、不要解释。",
      "",
      `需求：${q}`
    ].join("\n"),
    mode: "general",
    memoryTurns: [],
    sessionState: null,
    authHeaders,
    signal,
    allowEmptyAnswer: true,
    authorIpPrompt:
      "你是标题编辑。title 须中文、12～20 字、无书名号、无「小红书」前缀、无标点结尾。"
  });

  return parseTitleFromLlmAnswer(done.answer.trim());
}
