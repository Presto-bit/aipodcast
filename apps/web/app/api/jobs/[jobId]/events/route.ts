import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyEventStreamFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

/**
 * 任务事件 SSE：同源 EventSource 会自动携带 HttpOnly 会话 Cookie，BFF 转为上游 Authorization。
 * 不在 Query 中接受 access_token，避免进入 Referer/日志。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const afterId = req.nextUrl.searchParams.get("after_id") || "0";
  const path = `/api/v1/jobs/${params.jobId}/events?after_id=${encodeURIComponent(afterId)}`;
  return proxyEventStreamFromOrchestrator(path, {
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
