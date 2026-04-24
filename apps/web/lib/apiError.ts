/** BFF 等业务错误码 → 用户可读说明（避免只显示英文 code） */
const KNOWN_ERROR_CODES: Record<string, string> = {
  upstream_unreachable: "无法连接编排服务或网关在等待上游时超时，请确认编排器已启动、网络正常，或稍后重试。"
};

/** 解析 BFF / FastAPI 常见错误体：`error`、`detail` 字符串或校验错误数组 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const o = data as Record<string, unknown>;
  if (typeof o.error === "string" && o.error.trim()) {
    const code = o.error.trim();
    // BFF 在 upstream_unreachable 时会把 describeOrchestratorUnreachable 写入 detail（含 ORCHESTRATOR_URL 等），优先展示便于排障
    if (code === "upstream_unreachable" && typeof o.detail === "string" && o.detail.trim()) {
      return o.detail.trim();
    }
    return KNOWN_ERROR_CODES[code] ?? code;
  }
  if (typeof o.detail === "string" && o.detail.trim()) return o.detail.trim();
  if (Array.isArray(o.detail) && o.detail.length > 0) {
    const first = o.detail[0];
    if (first && typeof first === "object" && first !== null && "msg" in first) {
      return String((first as { msg: unknown }).msg);
    }
  }
  return fallback;
}

/** 知识库流式问答：编排器 / SSE 常见英文 code → 中文说明 */
export function formatNotesAskStreamError(message: string): string {
  const m = (message || "").trim();
  if (!m) return "对话失败，请稍后重试。";
  const map: Record<string, string> = {
    empty_answer:
      "模型未返回有效正文，请换一个问题或稍后重试；若使用推理类文本模型，可尝试非推理版本。",
    minimax_api_key_missing: "未配置 MiniMax API Key，无法完成问答。",
    openai_compatible_empty_content: "上游模型返回内容为空，请检查 API 与模型配置后重试。",
    chat_messages_empty: "发送给模型的消息为空，请刷新页面后重试。",
    upstream_error: "上游模型服务异常，请稍后重试。"
  };
  if (map[m]) return map[m];
  if (m.startsWith("text_provider_") && m.endsWith("_config_missing")) {
    return "文本模型 API 未正确配置（密钥或 Base URL），请检查环境变量后重试。";
  }
  return m;
}
