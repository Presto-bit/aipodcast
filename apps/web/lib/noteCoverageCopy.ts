/** 资料预览/状态栏：区分「向量抽样覆盖率」与「片摘要进度」 */
export function buildNoteCoverageLine(data: {
  totalChars?: number;
  ragIndexCoveragePct?: number;
  shardsTotal?: number;
  shardsWithSummary?: number;
  chaptersTotal?: number;
  chaptersWithSummary?: number;
  ragIndexTruncated?: boolean;
}): string | null {
  const total = Number(data.totalChars || 0);
  if (total <= 0) return null;
  const cov = Number(data.ragIndexCoveragePct || 0);
  const shTot = Number(data.shardsTotal || 0);
  const shSum = Number(data.shardsWithSummary || 0);
  const chTot = Number(data.chaptersTotal || 0);
  const chSum = Number(data.chaptersWithSummary || 0);
  const shardDigestComplete = shTot > 1 && shSum >= shTot;

  if (shardDigestComplete) {
    return (
      `全文约 ${total.toLocaleString()} 字 · 片摘要 ${shSum}/${shTot} 已完成 · ` +
      `向量检索抽样约 ${cov}% 正文（问答可走片路由/精读，非摘要未完成）`
    );
  }

  let line = `全文约 ${total.toLocaleString()} 字 · 向量检索抽样约 ${cov}%`;
  if (shTot > 1) {
    line += ` · 片摘要 ${shSum}/${shTot}`;
  } else if (chTot > 0) {
    line += ` · 章摘要 ${chSum}/${chTot}`;
  }
  if (data.ragIndexTruncated) {
    line += "（向量块未全覆盖，请指明章节或部分提问）";
  }
  return line;
}

export function shouldShowVectorTruncationWarning(data: {
  ragIndexTruncated?: boolean;
  ragIndexCoveragePct?: number;
  shardsTotal?: number;
  shardsWithSummary?: number;
}): boolean {
  if (!data.ragIndexTruncated || (data.ragIndexCoveragePct ?? 0) <= 0) return false;
  const shTot = Number(data.shardsTotal || 0);
  const shSum = Number(data.shardsWithSummary || 0);
  if (shTot > 1 && shSum >= shTot) return false;
  return true;
}
