/** 与 orchestrator `subscription_manifest.MAX_NOTE_REFS_BY_TIER` 一致 */

/** 进 TTS 前「口述润色」：仅 Max 档（且服务端 AI_POLISH_FEATURE_ENABLED 未关） */
export function mayUseAiPolishPlan(plan: string | undefined | null): boolean {
  return (plan || "free").trim().toLowerCase() === "max";
}

export function maxNotesForReferencePlan(plan: string | undefined | null): number {
  const p = (plan || "free").trim().toLowerCase();
  if (p === "max") return 12;
  if (p === "pro") return 6;
  if (p === "basic") return 3;
  if (p === "payg") return 1;
  return 1;
}
