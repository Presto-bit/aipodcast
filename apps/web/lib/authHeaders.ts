/**
 * EventSource 无法自定义 Header；同源请求会自动携带 HttpOnly 会话 Cookie，BFF 再转为上游 Authorization。
 */
export function getBearerAuthHeadersSync(): Record<string, string> {
  return {};
}

export function jobEventsSourceUrl(jobId: string, afterId: number): string {
  const jid = encodeURIComponent(jobId);
  const aid = encodeURIComponent(String(afterId));
  return `/api/jobs/${jid}/events?after_id=${aid}`;
}
