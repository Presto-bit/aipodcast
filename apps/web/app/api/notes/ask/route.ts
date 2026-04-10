import { NextRequest } from "next/server";
import { incomingAuthHeadersFrom, proxyJsonFromOrchestrator } from "../../../../lib/bff";

/** 与编排器 notes/ask 内 LLM 超时（约 120s）对齐，避免默认 10s 提前 Abort 导致无回答 */
const NOTES_ASK_UPSTREAM_TIMEOUT_MS = 180_000;

/** Vercel 等托管环境延长 Serverless 执行上限（需平台套餐支持） */
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/notes/ask", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: NOTES_ASK_UPSTREAM_TIMEOUT_MS,
    headers: { "content-type": "application/json", ...incomingAuthHeadersFrom(req) }
  });
}
