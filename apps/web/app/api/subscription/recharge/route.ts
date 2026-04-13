import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

/**
 * 与 /api/subscription/alipay-page/wallet 等价：显式「充值」入口别名，便于前端与其它系统对齐。
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/subscription/alipay/page/wallet", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
