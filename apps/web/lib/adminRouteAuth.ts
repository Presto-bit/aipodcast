import { NextRequest } from "next/server";
import { fetchOrchestrator, incomingAuthHeadersFrom } from "./bff";

type AdminAuthResult =
  | { ok: true; operator: string }
  | { ok: false; status: number; error: string };

function normalizeOperator(user: Record<string, unknown>): string {
  for (const key of ["user_id", "phone", "email", "username"] as const) {
    const val = user[key];
    if (typeof val === "string" && val.trim()) return val.trim().slice(0, 120);
  }
  return "admin";
}

export async function verifyAdminRequest(req: NextRequest): Promise<AdminAuthResult> {
  const auth = incomingAuthHeadersFrom(req);
  if (!auth.authorization) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  let upstream: Response;
  try {
    upstream = await fetchOrchestrator("/api/v1/auth/me", {
      method: "GET",
      payload: "{}",
      headers: auth,
      timeoutMs: 12_000
    });
  } catch {
    return { ok: false, status: 502, error: "auth_upstream_unreachable" };
  }
  const data = (await upstream.json().catch(() => ({}))) as {
    success?: boolean;
    user?: Record<string, unknown>;
  };
  if (!upstream.ok || !data.success || !data.user) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const role = String(data.user.role || "").trim().toLowerCase();
  if (role !== "admin") {
    return { ok: false, status: 403, error: "forbidden_admin_only" };
  }
  return { ok: true, operator: normalizeOperator(data.user) };
}
