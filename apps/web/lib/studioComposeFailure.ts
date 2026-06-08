import { isInsufficientBrief } from "./studioOrchestrator";

export type StudioComposeSoftFailure = "needs_brief" | "needs_rewrite";

const SOFT_ERROR_RE =
  /NEEDS_BRIEF|NEEDS_REWRITE|通用模板|validation_failed|成稿像是|补充受众|过于相似/;

/** 成稿软失败是否应走温和 UI（非 work.error 红字） */
export function isComposeSoftFailure(error: string): boolean {
  return SOFT_ERROR_RE.test(error) || error.includes("模板");
}

/**
 * brief 不足 → 追问补全；brief 已够但生成质量差 → 提示重写（Cursor 式）
 */
export function classifyComposeSoftFailure(
  error: string,
  composeTask: string
): StudioComposeSoftFailure | null {
  if (!isComposeSoftFailure(error)) return null;
  if (/NEEDS_REWRITE/.test(error)) return "needs_rewrite";
  if (/NEEDS_BRIEF/.test(error)) return "needs_brief";
  if (composeTask.trim() && !isInsufficientBrief(composeTask)) return "needs_rewrite";
  return "needs_brief";
}

export function studioComposeFailureNote(code: StudioComposeSoftFailure): string {
  return code === "needs_rewrite" ? "NEEDS_REWRITE" : "NEEDS_BRIEF";
}
