import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/author-ips/default", {
    method: "GET",
    headers: incomingAuthHeadersFrom(req)
  });
}
