import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { jobId: string } };

/**
 * 使用 POST 删除任务（与 DELETE /api/jobs/[jobId] 等价）。
 * 部分反向代理 / 托管环境对 DELETE 返回 405，故提供此别名。
 */
export async function POST(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/jobs/${params.jobId}/delete`, {
    method: "POST",
    payload: "{}",
    body: "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
