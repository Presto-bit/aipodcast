import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

/**
 * 管理员只读：订阅与权限矩阵 JSON（与编排器 entitlement_matrix 一致）。
 */
export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/admin/entitlement-matrix", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
