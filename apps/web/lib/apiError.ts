/** BFF 等业务错误码 → 用户可读说明（避免只显示英文 code） */
const KNOWN_ERROR_CODES: Record<string, string> = {
  upstream_unreachable: "无法连接编排服务或网关在等待上游时超时，请确认编排器已启动、网络正常，或稍后重试。"
};

/** 知识库流式 / 非流式：常见英文 code → 中文说明 */
const NOTES_ASK_CODE_MAP: Record<string, string> = {
  empty_answer:
    "模型未返回有效正文，请换一个问题或稍后重试；若使用推理类文本模型，可尝试非推理版本。",
  minimax_api_key_missing: "未配置 MiniMax API Key，无法完成问答。",
  openai_compatible_empty_content: "上游模型返回内容为空，请检查 API 与模型配置后重试。",
  chat_messages_empty: "发送给模型的消息为空，请刷新页面后重试。",
  upstream_error: "上游模型服务异常，请稍后重试。",
  empty_context:
    "当前勾选资料没有可用于问答的正文（可能尚在解析/索引中）。请打开资料预览确认已有文字，或稍后再试。",
  note_not_found: "部分资料已不存在或无权访问，请刷新列表后重新勾选。",
  notebook_not_shared: "该分享笔记本不可访问或链接已失效。",
  notebook_required: "请先选择笔记本。",
  note_ids_required: "请至少勾选一条资料后再提问。",
  question_required: "请输入问题。",
  too_many_notes: "勾选的资料条数超过上限，请减少勾选后再试。",
  note_notebook_mismatch: "勾选资料与当前笔记本不一致，请刷新后重选。",
  hints_llm_output_invalid: "导读模型返回格式异常，请稍后重试或换一批资料。",
  hints_failed: "导读暂时无法生成，请稍后重试。"
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
    if (typeof first === "string" && first.trim()) return first.trim();
    if (first && typeof first === "object" && first !== null && "msg" in first) {
      return String((first as { msg: unknown }).msg);
    }
  }
  return fallback;
}

/** 知识库对话错误：编排器 SSE `error` 事件或 HTTP 失败时的附加字段 */
export type NotesAskStreamErrorMeta = {
  code?: string;
  detail?: string;
  requestId?: string;
  textProvider?: string;
  hint?: string;
  httpStatus?: number;
  /** 非 JSON 或 HTML 错误页时截取一段原文 */
  rawPreview?: string;
};

function mapTextProviderConfigHint(message: string): string | undefined {
  const m = (message || "").trim();
  if (m.startsWith("text_provider_") && m.endsWith("_config_missing")) {
    return "文本模型 API 未正确配置（密钥或 Base URL），请检查环境变量后重试。";
  }
  return undefined;
}

/**
 * 知识库流式问答：主文案 + 可选诊断块（编排器 SSE error 事件会带 code/detail/requestId 等）。
 */
export function formatNotesAskStreamError(message: string, meta?: NotesAskStreamErrorMeta): string {
  const raw = (message || "").trim();
  const code = (meta?.code || "").trim();
  const fromCode = code && NOTES_ASK_CODE_MAP[code] ? NOTES_ASK_CODE_MAP[code] : "";
  const fromMessage = raw && NOTES_ASK_CODE_MAP[raw] ? NOTES_ASK_CODE_MAP[raw] : "";
  const configHint = mapTextProviderConfigHint(raw) || mapTextProviderConfigHint(code);
  const base = fromCode || fromMessage || configHint || raw || "对话失败，请稍后重试。";

  const lines: string[] = [base];
  if (meta?.httpStatus != null && Number.isFinite(meta.httpStatus)) {
    lines.push(`HTTP 状态：${meta.httpStatus}`);
  }
  if (meta?.textProvider?.trim()) {
    lines.push(`文本路由（TEXT_PROVIDER 解析结果）：${meta.textProvider.trim()}`);
  }
  if (meta?.code?.trim() && meta.code.trim() !== raw && !fromCode) {
    lines.push(`异常/编码：${meta.code.trim()}`);
  }
  if (meta?.detail?.trim()) {
    lines.push(`诊断详情：${meta.detail.trim()}`);
  }
  if (meta?.rawPreview?.trim()) {
    lines.push(`响应片段：${meta.rawPreview.trim()}`);
  }
  if (meta?.hint?.trim()) {
    lines.push(`排查提示：${meta.hint.trim()}`);
  }
  if (meta?.requestId?.trim()) {
    lines.push(`请求 ID（对齐编排器 / BFF 日志）：${meta.requestId.trim()}`);
  }
  return lines.join("\n\n");
}
