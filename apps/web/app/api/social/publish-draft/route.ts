import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";
import { SOCIAL_PUBLISH_BFF_TIMEOUT_MS } from "../../../../lib/socialPublishTimeouts";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/social/publish-draft", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: SOCIAL_PUBLISH_BFF_TIMEOUT_MS
  });
}
