/** Studio V2 — 失败分类短 copy + retry */

export type StudioFailureCode =
  | "network"
  | "timeout"
  | "model"
  | "cancelled"
  | "partial"
  | "unknown";

export type StudioFailureCopy = {
  code: StudioFailureCode;
  message: string;
  canRetry: boolean;
  canApplyPartial?: boolean;
};

export function classifyStudioFailure(raw: string, aborted = false): StudioFailureCopy {
  if (aborted || /cancel|aborted|已取消|已停止/i.test(raw)) {
    return { code: "cancelled", message: "已停止 · 可继续输入", canRetry: false };
  }
  const msg = raw.trim();
  if (!msg) {
    return { code: "unknown", message: "生成失败 · 重试", canRetry: true };
  }
  if (/network|failed to fetch|fetch failed|网络/i.test(msg)) {
    return { code: "network", message: "网络中断 · 重试", canRetry: true };
  }
  if (/timeout|timed out|超时/i.test(msg)) {
    return { code: "timeout", message: "生成超时 · 重试", canRetry: true };
  }
  if (/model|rate limit|429|503|502|overloaded|模型/i.test(msg)) {
    return { code: "model", message: "模型暂时不可用 · 重试", canRetry: true };
  }
  if (/partial|未完成|预览/i.test(msg)) {
    return {
      code: "partial",
      message: "已保留部分改动 · 采纳部分或放弃",
      canRetry: false,
      canApplyPartial: true
    };
  }
  if (msg.length <= 40) {
    return { code: "unknown", message: `${msg} · 重试`, canRetry: true };
  }
  return { code: "unknown", message: "生成失败 · 重试", canRetry: true };
}
