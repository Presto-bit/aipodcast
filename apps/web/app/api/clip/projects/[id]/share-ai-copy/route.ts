import type { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../../../lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 与编排器 LLM 生成对齐，避免平台默认短超时导致浏览器侧 Failed to fetch */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const path = `/api/v1/clip/projects/${encodeURIComponent(id)}/share-ai-copy`;
  const raw = await req.text();
  const body = raw.trim().length ? raw : "{}";
  return proxyJsonFromOrchestrator(path, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) },
    timeoutMs: 120_000
  });
}
