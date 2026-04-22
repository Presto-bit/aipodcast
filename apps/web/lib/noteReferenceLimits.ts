/** 与编排器 `subscription_manifest.BILLING_MAX_NOTE_REFS` 对齐 */

export const MAX_NOTE_REFS_PER_JOB = 100;

/** 笔记本 / 播客工作室 / TTS：参考资料条数上限（不再区分身份） */
export function maxNotesForReference(): number {
  return MAX_NOTE_REFS_PER_JOB;
}

/** 口述润色、批量下载等：默认可用 */
export function aiPolishAllowed(): boolean {
  return true;
}

export function bundledWorksDownloadAllowed(): boolean {
  return true;
}

export function notesRoomFeaturesEnabled(): boolean {
  return true;
}

/** 勾选达上限时的提示（不展示具体条数） */
export function notesRefSelectionLimitMessage(): string {
  return "已达到可选资料上限，请先取消部分勾选。";
}
