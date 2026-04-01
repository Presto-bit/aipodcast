import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export async function POST(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/admin/tts-polish-prompts/reset", {
    method: "POST",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}
