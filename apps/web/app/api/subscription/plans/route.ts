import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

/** 与钱包价目编排器 `GET /api/v1/subscription/plans` 对齐（前端历史路径）。 */
export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/subscription/plans", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
