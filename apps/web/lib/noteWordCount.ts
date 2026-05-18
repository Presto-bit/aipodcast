/** 与 orchestrator `_estimate_word_count` 一致：中文按字、英文/数字按词。 */
export function estimateWordCount(text: string): number {
  const body = String(text || "").trim();
  if (!body) return 0;
  const cjk = body.match(/[\u4e00-\u9fff]/g);
  const latin = body.match(/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g);
  return (cjk?.length ?? 0) + (latin?.length ?? 0);
}
