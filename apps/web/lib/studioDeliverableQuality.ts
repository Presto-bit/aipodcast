const TEMPLATE_MARKERS = [
  "📌 先说结论",
  "💡 展开",
  "💡 其次",
  "✅ 最后",
  "要点一",
  "要点二",
  "先把最重要的信息说清楚",
  "请根据以下创作任务",
  "【创作任务】",
  "【创作偏好】",
  "撰写一篇完整、可直接",
  "你是不是也一到下午就脸垮",
  "先把作息和防晒稳住",
  "打工人熬夜党！百元搞定暗沉",
  "你觉得哪一点最有用"
] as const;

/** 识别成稿正文误回显 intake 偏好、提示词或通用模板骨架 */
export function deliverableBodyLooksLikeIntakeEcho(body: string): boolean {
  const text = body.trim();
  if (!text) return true;
  if (text.includes("账号阶段：") && text.includes("读者：")) return true;
  if (text.includes("禁止📌先说结论") || text.includes("正文须为围绕【创作任务】")) return true;

  const hits = TEMPLATE_MARKERS.filter((m) => text.includes(m)).length;
  if (hits >= 2) return true;
  if (hits >= 1 && /📌|💡|✅/.test(text)) return true;
  if (text.includes("📌") && text.includes("💡") && text.length < 500) return true;
  if (/干货分享.*真实体验.*知识整理/.test(text)) return true;

  return false;
}

/** 首稿 compose 校验模板回显；revise 在已有版本上迭代，跳过模板启发式 */
export function shouldRejectDeliverableBody(
  tool: "compose" | "revise" | string,
  body: string
): boolean {
  const text = body.trim();
  if (!text) return true;
  if (tool === "revise") return false;
  return deliverableBodyLooksLikeIntakeEcho(text);
}
