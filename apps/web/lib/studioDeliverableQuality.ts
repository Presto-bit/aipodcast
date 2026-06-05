/** 识别成稿正文误回显 intake 偏好或任务前缀 */
export function deliverableBodyLooksLikeIntakeEcho(body: string): boolean {
  const text = body.trim();
  if (!text) return true;
  if (text.includes("账号阶段：") && text.includes("读者：")) return true;
  if (text.includes("禁止📌先说结论") || text.includes("禁止📌先说结论/")) return true;
  if (text.includes("正文须为围绕【创作任务】")) return true;
  return false;
}
