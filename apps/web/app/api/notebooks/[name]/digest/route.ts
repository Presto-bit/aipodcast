import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../lib/bff";

type Params = { params: { name: string } };

export async function GET(req: NextRequest, { params }: Params) {
  return proxyJsonFromOrchestrator(`/api/v1/notebooks/${encodeURIComponent(params.name)}/digest`, {
    method: "GET",
    headers: incomingAuthHeadersFrom(req)
  });
}
