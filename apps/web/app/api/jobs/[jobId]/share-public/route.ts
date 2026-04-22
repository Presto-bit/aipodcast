import { NextRequest } from "next/server";
import { getOrCreateRequestId, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

/** 匿名可访问：成片试听元数据（不经用户会话） */
export async function GET(req: NextRequest, { params }: Params) {
  const rid = getOrCreateRequestId(req);
  return proxyJsonFromOrchestrator(`/api/v1/public/jobs/${encodeURIComponent(params.jobId)}/share-listen`, {
    method: "GET",
    payload: "{}",
    headers: {},
    timeoutMs: 45_000,
    requestId: rid
  });
}
