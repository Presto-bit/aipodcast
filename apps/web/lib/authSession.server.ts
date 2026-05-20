import crypto from "crypto";
import { cookies } from "next/headers";
import {
  orchestratorGetJsonPart,
  ORCHESTRATOR_TIMEOUT_AUTH_MS,
  SESSION_COOKIE_NAME
} from "./bff";
import type { InitialAuthSession, InitialAuthUser } from "./authSession";

const AUTH_CONFIG_TIMEOUT_MS = 8_000;

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function authHeadersFromCookieStore(store: CookieStore): Record<string, string> {
  const token = store.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (token) return { authorization: `Bearer ${token}` };
  return {};
}

/**
 * 服务端解析会话（与 GET /api/auth/session 语义一致），供 RSC layout 注入首屏 Auth。
 */
export async function resolveAuthSessionServer(cookieStore?: CookieStore): Promise<InitialAuthSession> {
  const store = cookieStore ?? (await cookies());
  const headers = authHeadersFromCookieStore(store);
  const rid = crypto.randomUUID();

  const [configPart, mePart] = await Promise.all([
    orchestratorGetJsonPart("/api/v1/auth/config", headers, rid, {
      timeoutMs: AUTH_CONFIG_TIMEOUT_MS,
      retryGetOnce: false
    }),
    orchestratorGetJsonPart("/api/v1/auth/me", headers, rid, {
      timeoutMs: ORCHESTRATOR_TIMEOUT_AUTH_MS,
      retryGetOnce: false
    })
  ]);

  const configData = (configPart.data ?? {}) as { auth_required?: boolean };
  let authRequired = true;
  if (configPart.ok && typeof configData.auth_required === "boolean") {
    authRequired = configData.auth_required;
  } else if (!configPart.ok) {
    authRequired = true;
  } else {
    authRequired = Boolean(configData.auth_required ?? false);
  }

  if (!authRequired) {
    return {
      authRequired: false,
      user: { phone: "local", display_name: "访客" },
      sessionResolved: true,
      hydrateFromServer: true
    };
  }

  const parseMe = (part: typeof mePart): InitialAuthUser | null => {
    const d = (part.data ?? {}) as { success?: boolean; user?: InitialAuthUser };
    return part.ok && d.success && d.user ? d.user : null;
  };

  let user = parseMe(mePart);
  if (!user && (mePart.status === 401 || mePart.status === 403)) {
    await new Promise((r) => setTimeout(r, 120));
    const retry = await orchestratorGetJsonPart("/api/v1/auth/me", headers, rid, {
      timeoutMs: ORCHESTRATOR_TIMEOUT_AUTH_MS,
      retryGetOnce: false
    });
    user = parseMe(retry);
  }

  if (user) {
    return {
      authRequired: true,
      user,
      sessionResolved: true,
      hydrateFromServer: true
    };
  }

  if (mePart.status === 401 || mePart.status === 403) {
    return {
      authRequired: true,
      user: null,
      sessionResolved: true,
      hydrateFromServer: true
    };
  }

  return {
    authRequired: true,
    user: null,
    sessionResolved: true,
    hydrateFromServer: true
  };
}
