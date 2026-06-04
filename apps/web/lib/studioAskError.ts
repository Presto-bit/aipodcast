/** Studio Agent 问答错误 → 用户可读文案 */
export function formatStudioAskError(raw: string): string {
  const msg = raw.trim();
  if (!msg) return "问答失败，请稍后重试";
  if (msg.includes("invalid_request_body")) {
    return "请求格式校验失败（常见于问题过长）。请重试；若仍失败请缩短输入或刷新页面。";
  }
  if (msg.includes("note_ids_required") || msg.includes("notebook_required")) {
    return "请先绑定笔记本并勾选至少一篇资料。";
  }
  if (msg.includes("question_required")) return "请输入内容后再发送。";
  return msg.replace(/^出错了：/, "");
}
