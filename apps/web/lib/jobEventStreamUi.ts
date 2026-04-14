/**
 * 编排器任务事件流中 `event_type === "log"` 的条目用于排障（如 request_id、RQ id），
 * 不应覆盖面向用户的「当前阶段」主文案。
 */
export function isJobEventLogOnlyForUi(eventType: string | undefined): boolean {
  return String(eventType || "").toLowerCase() === "log";
}
