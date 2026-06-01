import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

export async function GET(req: NextRequest) {
  const notebookName = req.nextUrl.searchParams.get("notebookName")?.trim() || "";
  if (!notebookName) {
    return Response.json({ success: false, detail: "notebookName_required" }, { status: 400 });
  }
  const q = new URLSearchParams({ notebookName });
  return proxyJsonFromOrchestrator(`/api/v1/author-ips/by-notebook?${q}`, {
    method: "GET",
    headers: incomingAuthHeadersFrom(req)
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text().catch(() => "{}");
  return proxyJsonFromOrchestrator("/api/v1/author-ips/by-notebook/ensure", {
    method: "POST",
    payload: body || "{}",
    body: body || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.text().catch(() => "{}");
  return proxyJsonFromOrchestrator("/api/v1/author-ips/by-notebook", {
    method: "PATCH",
    payload: body || "{}",
    body: body || "{}",
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
