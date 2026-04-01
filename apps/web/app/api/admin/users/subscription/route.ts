import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/admin/users/subscription", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
