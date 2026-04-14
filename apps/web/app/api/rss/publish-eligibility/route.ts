import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

/** GET ?job_id= 预检是否可以发布到 RSS（与 POST /api/rss/publish 规则一致） */
export async function GET(req: NextRequest) {
  const jid = req.nextUrl.searchParams.get("job_id")?.trim() ?? "";
  const q = jid ? `?job_id=${encodeURIComponent(jid)}` : "";
  return proxyJsonFromOrchestrator(`/api/v1/rss/publish-eligibility${q}`, {
    method: "GET",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
