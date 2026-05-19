import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

type Params = { params: { name: string; task: string } };

export async function POST(req: NextRequest, { params }: Params) {
  const body = await req.text();
  return proxyJsonFromOrchestrator(
    `/api/v1/notebooks/${encodeURIComponent(params.name)}/studio/${encodeURIComponent(params.task)}`,
    {
      method: "POST",
      payload: body || "{}",
      body: body || "{}",
      headers: {
        "content-type": "application/json",
        ...incomingAuthHeadersFrom(req)
      }
    }
  );
}
