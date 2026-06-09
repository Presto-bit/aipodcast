import {
  isExplicitAskWhileReady,
  looksLikeManuscriptEditRequest,
  STUDIO_MANUSCRIPT_READ_RE
} from "./studioReviseIntent";
import type { StudioAgentMode } from "./studioAgentMode";
import type { StudioAgentTurn, StudioWork } from "./studioWorkTypes";
import { composeTaskSentenceFromTurns } from "./studioWorkTask";
import { deriveStudioLifecycle, hasCommittedManuscript } from "./studioLifecycle";
import { shouldForceStudioCompose } from "./studioComposeChip";

export type StudioAgentAction = "create" | "edit" | "converse";

export type LegacyStudioRunTool = "generate" | "revise" | "ask";

const WRITE_INTENT =
  /生成|成稿|创作一篇|写一篇|开始写|帮我写|帮我做一篇|我想创作|我想写|编写|推广文案|小红书/;

function isAskOnlyMessage(text: string, hasManuscript: boolean): boolean {
  const q = text.trim();
  if (!q) return true;
  if (hasManuscript && looksLikeManuscriptEditRequest(q, true)) return false;
  if (WRITE_INTENT.test(q)) return false;
  if (/[?？]$/.test(q)) return true;
  if (/怎么(写|改|搭)|如何(写|改)|钩子|开头|结构/.test(q)) return true;
  if (/^(帮我)?(分析|解读|看看|讲讲)/.test(q)) return true;
  if (/运营|策略|涨粉|流量|算法/.test(q) && !WRITE_INTENT.test(q)) return true;
  return false;
}

export function resolveStudioAgentAction(params: {
  work: StudioWork;
  message: string;
  turns?: StudioAgentTurn[];
  agentMode?: StudioAgentMode;
  forceCompose?: boolean;
}): StudioAgentAction {
  const { work, message, turns, agentMode = "write", forceCompose = false } = params;
  if (agentMode === "ask") return "converse";

  const lifecycle = deriveStudioLifecycle(work);
  const hasMs = hasCommittedManuscript(work);
  const q = message.trim();
  const brief = composeTaskSentenceFromTurns(turns ?? work.agentTurns, q);

  if (shouldForceStudioCompose(q, forceCompose) && !hasMs) return "create";

  if (lifecycle === "running") {
    if (isExplicitAskWhileReady(q) || STUDIO_MANUSCRIPT_READ_RE.test(q)) return "converse";
    if (hasMs && looksLikeManuscriptEditRequest(q, true)) return "edit";
    if (WRITE_INTENT.test(q) || brief.length >= 4) return "create";
    return "converse";
  }

  if (hasMs) {
    if (isExplicitAskWhileReady(q) || STUDIO_MANUSCRIPT_READ_RE.test(q)) return "converse";
    if (looksLikeManuscriptEditRequest(q, true)) return "edit";
  }

  if (isAskOnlyMessage(q, hasMs)) return "converse";
  if (!hasMs && (brief || WRITE_INTENT.test(q) || q.length >= 4)) return "create";
  return "converse";
}

export function actionToLegacyRunTool(action: StudioAgentAction): LegacyStudioRunTool {
  if (action === "create") return "generate";
  if (action === "edit") return "revise";
  return "ask";
}

export function actionToLegacyStreamTool(action: StudioAgentAction): "compose" | "revise" | "reply" {
  if (action === "create") return "compose";
  if (action === "edit") return "revise";
  return "reply";
}
