import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export async function GET(req: NextRequest, ctx: { params: { phone: string } }) {
  const phone = encodeURIComponent((ctx.params?.phone || "").trim());
  const q = req.nextUrl.searchParams.toString();
  const path = q ? `/api/v1/admin/usage/users/${phone}?${q}` : `/api/v1/admin/usage/users/${phone}`;
  return proxyJsonFromOrchestrator(path, {
    method: "GET",
    payload: "{}",
    headers: { ...incomingAuthHeadersFrom(req) },
  });
}
