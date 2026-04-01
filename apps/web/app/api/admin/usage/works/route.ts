import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.toString();
  const path = q ? `/api/v1/admin/usage/works?${q}` : "/api/v1/admin/usage/works";
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) },
  });
}
