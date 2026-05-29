export const NOTES_ASK_SOURCE_REQUIRED = "请先勾选左侧资料";

export const NOTES_ASK_DEBUG_BODY_ENABLED =
  String(process.env.NEXT_PUBLIC_NOTES_ASK_DEBUG_BODY || "").trim() === "1";

/** 历史「导读」助手气泡 id 前缀；加载会话时剔除，避免旧数据占位 */
export const NOTES_ASK_HINTS_BOOT_PREFIX = "__hints_boot__";
