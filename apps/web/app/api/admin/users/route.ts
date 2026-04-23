import { NextRequest } from "next/server";
import {
  incomingAuthHeadersFrom,
  ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
  proxyJsonFromOrchestrator
} from "../../../../lib/bff";

/** 用户列表/增删可能触达较慢的 PG 或跨区编排器，与 BFF 慢上游超时对齐，降低 504 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return proxyJsonFromOrchestrator("/api/v1/admin/users", {
    method: "GET",
    payload: "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: { ...incomingAuthHeadersFrom(req) }
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/admin/users", {
    method: "POST",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}

export async function DELETE(req: NextRequest) {
  const raw = await req.text();
  return proxyJsonFromOrchestrator("/api/v1/admin/users", {
    method: "DELETE",
    payload: raw || "{}",
    body: raw || "{}",
    timeoutMs: ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS,
    headers: {
      "content-type": "application/json",
      ...incomingAuthHeadersFrom(req)
    }
  });
}
