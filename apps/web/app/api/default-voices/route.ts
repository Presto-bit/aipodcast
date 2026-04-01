import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../lib/bff";

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/default-voices", {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
