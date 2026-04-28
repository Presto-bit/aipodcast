import { NextRequest } from "next/server";
import { fetchOrchestrator, incomingAuthHeadersFrom } from "./bff";

export type AdminPermission = "log:view" | "log:manage";

type AdminAuthResult =
  | { ok: true; operator: string; permissions: AdminPermission[] }
  | { ok: false; status: number; error: string };

function normalizeOperator(user: Record<string, unknown>): string {
  for (const key of ["user_id", "phone", "email", "username"] as const) {
    const val = user[key];
    if (typeof val === "string" && val.trim()) return val.trim().slice(0, 120);
  }
  return "admin";
}

function parseExplicitPermissions(user: Record<string, unknown>): AdminPermission[] {
  const src = user.permissions;
  if (!Array.isArray(src)) return [];
  const out = new Set<AdminPermission>();
  for (const item of src) {
    const p = String(item || "").trim();
    if (p === "log:view") out.add("log:view");
    if (p === "log:manage") out.add("log:manage");
  }
  return [...out];
}

function parseAllowlist(envName: string): Set<string> {
  const raw = String(process.env[envName] || "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function resolvePermissions(user: Record<string, unknown>, operator: string): AdminPermission[] {
  const explicit = parseExplicitPermissions(user);
  if (explicit.length > 0) return explicit;
  const role = String(user.role || "").trim().toLowerCase();
  if (role !== "admin") return [];
  const allowView = parseAllowlist("LOG_VIEW_ALLOWED_OPERATORS");
  const allowManage = parseAllowlist("LOG_MANAGE_ALLOWED_OPERATORS");
  const perms = new Set<AdminPermission>();
  if (allowView.size === 0 || allowView.has(operator)) perms.add("log:view");
  if (allowManage.size === 0 || allowManage.has(operator)) perms.add("log:manage");
  return [...perms];
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
  const operator = normalizeOperator(data.user);
  const permissions = resolvePermissions(data.user, operator);
  return { ok: true, operator, permissions };
}

export async function verifyAdminPermission(
  req: NextRequest,
  permission: AdminPermission
): Promise<AdminAuthResult> {
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) return auth;
  if (!auth.permissions.includes(permission)) {
    return { ok: false, status: 403, error: "forbidden_permission_denied" };
  }
  return auth;
}
