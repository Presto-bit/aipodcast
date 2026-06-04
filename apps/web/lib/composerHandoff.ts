/** 对话 → 创作工具 handoff（sessionStorage + `/create?handoff=1`） */

export const COMPOSER_HANDOFF_STORAGE_KEY = "fym_composer_handoff_v1";

export type ComposerHandoff = {
  v: 1;
  source: "home_composer";
  sessionId: string;
  turnId: string;
  scriptText: string;
  scriptJobId?: string;
  notebook?: string;
  noteIds?: string[];
  outputMode?: "dialogue" | "article";
  durationHint?: "short" | "medium" | "long";
  stylePrompt?: string;
  authorIpPrompt?: string;
  programName?: string;
  returnTo: string;
  createdAt: number;
};

function isComposerHandoff(raw: unknown): raw is ComposerHandoff {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.source === "home_composer" &&
    typeof o.sessionId === "string" &&
    typeof o.turnId === "string" &&
    typeof o.scriptText === "string" &&
    typeof o.returnTo === "string" &&
    typeof o.createdAt === "number"
  );
}

/** 写入 handoff 包（对话页调用）；失败时静默。 */
export function writeComposerHandoff(payload: ComposerHandoff): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem(COMPOSER_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** 读取并清除 handoff 包；无效或缺失时返回 null。 */
export function consumeComposerHandoff(): ComposerHandoff | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(COMPOSER_HANDOFF_STORAGE_KEY);
    sessionStorage.removeItem(COMPOSER_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isComposerHandoff(parsed) ? parsed : null;
  } catch {
    try {
      sessionStorage.removeItem(COMPOSER_HANDOFF_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}
