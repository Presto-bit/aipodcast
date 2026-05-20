"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { pullCloudPreferences, setCloudPrefsSyncEnabled } from "./cloudPreferences";
import type { InitialAuthSession } from "./authSession";
import { accountKeyFromUser, setStorageAccountSync } from "./userScopedStorage";

const AUTH_TOKEN_KEY = "fym_auth_token";
const AUTH_PHONE_KEY = "fym_auth_phone";

/** FastAPI：detail 可能是 string 或 422 校验项数组 */
function formatFastApiDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = (data as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const parts = d.map((item) => {
      if (item && typeof item === "object" && "msg" in item) {
        const loc = (item as { loc?: unknown }).loc;
        const msg = String((item as { msg: unknown }).msg);
        if (Array.isArray(loc) && loc.length) {
          return `${loc.filter((x) => typeof x === "string" || typeof x === "number").join(".")}: ${msg}`;
        }
        return msg;
      }
      return String(item);
    });
    return parts.filter(Boolean).join("；");
  }
  return "";
}

function apiFailureMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const code = String((data as { code?: unknown }).code || "").trim();
    if (code === "AUTH_REQUIRED" || code === "FEATURE_AUTH_REQUIRED") {
      return "登录状态已失效，请重新登录后重试";
    }
  }
  const fmt = formatFastApiDetail(data);
  if (fmt) return fmt;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["detail", "error", "message"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return fallback;
}

export type AuthUser = {
  user_id?: string;
  phone?: string;
  email?: string;
  username?: string;
  email_verified?: boolean;
  display_name?: string;
  [k: string]: unknown;
};

/** `redirectTo: null` 表示清除会话后不跳转（例如留在设置页登录） */
export type LogoutOptions = { redirectTo?: string | null };

/** 发码接口返回：真实邮件投递与仅日志发码区分 */
export type RegisterSendCodeResult = { devOtpLogged?: boolean };

type AuthContextValue = {
  authRequired: boolean | null;
  /** @deprecated 会话已迁至 HttpOnly Cookie，保留字段恒为空串，勿用于判断登录态 */
  token: string;
  phone: string;
  user: AuthUser | null;
  /** 鉴权配置已就绪，且（未开鉴权或已完成 Cookie 会话校验） */
  ready: boolean;
  /** 从 `/api/auth/me` 刷新 `user`（如修改展示名后） */
  refreshMe: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  /** 邮箱验证码注册（方案 A）：先 send → verify 得 ticket → complete 写入会话 */
  registerSendCode: (params: {
    email: string;
    username: string;
    inviteCode?: string;
  }) => Promise<RegisterSendCodeResult>;
  registerVerifyCode: (params: { email: string; code: string }) => Promise<{ registration_ticket: string }>;
  registerComplete: (params: { registration_ticket: string; password: string }) => Promise<void>;
  logout: (options?: LogoutOptions) => Promise<void>;
  /**
   * 同源 fetch 已携带 HttpOnly 会话 Cookie，多数场景传空对象即可。
   * 不再读取 localStorage token。
   */
  getAuthHeaders: () => Record<string, string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getStorageItem(key: string): string {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function clearLegacyToken() {
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

function persistPhone(phone: string) {
  try {
    if (phone) window.localStorage.setItem(AUTH_PHONE_KEY, phone);
    else window.localStorage.removeItem(AUTH_PHONE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 拉取当前会话。401/403 仅再试一次（短退避）：覆盖登录后 Set-Cookie 与紧随其后的 /me 竞态。
 * 真实未登录会稳定 401，原先 4 次请求 + ~920ms 固定退避会造成整站首屏门闩明显卡顿。
 */
async function fetchAuthMe(signal?: AbortSignal): Promise<Response> {
  const doFetch = () =>
    fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(10_000)
    });
  const backoffMs = [0, 120];
  let res: Response | null = null;
  for (let i = 0; i < backoffMs.length; i++) {
    if (signal?.aborted) break;
    if (backoffMs[i] > 0) {
      await new Promise((r) => setTimeout(r, backoffMs[i]));
      if (signal?.aborted) break;
    }
    res = await doFetch();
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      continue;
    }
    return res;
  }
  return res ?? new Response(null, { status: 401 });
}

function accountHintFromUser(user: AuthUser | null | undefined): string {
  if (!user) return "";
  return (
    (typeof user.username === "string" && user.username) ||
    (typeof user.phone === "string" && user.phone) ||
    (typeof user.email === "string" && user.email) ||
    ""
  );
}

function bootFromInitialSession(initial?: InitialAuthSession): {
  authRequired: boolean | null;
  user: AuthUser | null;
  sessionResolved: boolean;
  phone: string;
  skipClientBootstrap: boolean;
  revalidateInBackground: boolean;
} {
  if (!initial?.hydrateFromServer) {
    return {
      authRequired: null,
      user: null,
      sessionResolved: false,
      phone: "",
      skipClientBootstrap: false,
      revalidateInBackground: false
    };
  }
  const u = (initial.user ?? null) as AuthUser | null;
  return {
    authRequired: initial.authRequired,
    user: u,
    sessionResolved: initial.sessionResolved,
    phone: accountHintFromUser(u),
    skipClientBootstrap: true,
    revalidateInBackground: Boolean(initial.revalidateInBackground)
  };
}

export function AuthProvider({
  children,
  initialSession
}: {
  children: React.ReactNode;
  initialSession?: InitialAuthSession;
}) {
  const router = useRouter();
  const boot = useMemo(() => bootFromInitialSession(initialSession), [initialSession]);
  const [authRequired, setAuthRequired] = useState<boolean | null>(boot.authRequired);
  const [phone, setPhone] = useState(boot.phone);
  const [user, setUser] = useState<AuthUser | null>(boot.user);
  const [sessionResolved, setSessionResolved] = useState(boot.sessionResolved);

  const storageAccountKey = useMemo(() => accountKeyFromUser(user), [user]);

  useLayoutEffect(() => {
    setStorageAccountSync(storageAccountKey);
  }, [storageAccountKey]);

  useLayoutEffect(() => {
    if (boot.phone) return;
    const ph = getStorageItem(AUTH_PHONE_KEY).trim();
    if (ph) setPhone(ph);
  }, [boot.phone]);

  const applyClientSessionPayload = useCallback(
    (res: Response, data: { auth_required?: boolean; success?: boolean; user?: AuthUser }) => {
      const ar = data.auth_required;
      if (typeof ar === "boolean") {
        setAuthRequired(ar);
      } else if (!res.ok) {
        setAuthRequired(true);
      } else {
        setAuthRequired(false);
      }

      if (ar === false) {
        setUser({ phone: "local", display_name: "访客" });
        clearLegacyToken();
        return;
      }

      if (res.ok && data.success && data.user) {
        setUser(data.user);
        const hint = accountHintFromUser(data.user);
        if (hint) {
          setPhone(hint);
          persistPhone(hint);
        }
        clearLegacyToken();
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setUser(null);
        clearLegacyToken();
        return;
      }
      setUser((prev) => {
        if (prev && (prev.phone || prev.display_name)) return prev;
        const ph = getStorageItem(AUTH_PHONE_KEY).trim();
        return { phone: ph || "用户" };
      });
    },
    []
  );

  useEffect(() => {
    if (boot.skipClientBootstrap) {
      if (!boot.revalidateInBackground) return;
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/auth/session", {
            cache: "no-store",
            credentials: "same-origin",
            signal: AbortSignal.timeout(12_000)
          });
          const data = (await res.json().catch(() => ({}))) as {
            auth_required?: boolean;
            success?: boolean;
            user?: AuthUser;
          };
          if (cancelled) return;
          applyClientSessionPayload(res, data);
        } catch {
          // 静态壳后台刷新失败不挡首屏
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 12_000);
    setSessionResolved(false);
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal: ac.signal
        });
        const data = (await res.json().catch(() => ({}))) as {
          auth_required?: boolean;
          success?: boolean;
          user?: AuthUser;
        };
        if (cancelled) return;
        applyClientSessionPayload(res, data);
      } catch {
        if (!cancelled) {
          setAuthRequired(true);
          setUser((prev) => {
            if (prev && (prev.phone || prev.display_name)) return prev;
            const ph = getStorageItem(AUTH_PHONE_KEY).trim();
            return ph ? { phone: ph } : null;
          });
        }
      } finally {
        if (!cancelled) setSessionResolved(true);
        clearTimeout(tid);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(tid);
      ac.abort();
    };
  }, [applyClientSessionPayload, boot.revalidateInBackground, boot.skipClientBootstrap]);

  useEffect(() => {
    if (authRequired === null) return;
    const loggedIn = Boolean(
      authRequired &&
        user &&
        user.phone !== "local" &&
        !!(user.user_id || user.phone || user.email || user.username)
    );
    setCloudPrefsSyncEnabled(loggedIn);
    if (!loggedIn) return;
    let cancelled = false;
    void (async () => {
      await pullCloudPreferences();
      if (!cancelled && typeof window !== "undefined") {
        try {
          window.dispatchEvent(new Event("fym-cloud-prefs-applied"));
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authRequired, user, user?.phone, user?.user_id, user?.email, user?.username]);

  const refreshMe = useCallback(async () => {
    if (!authRequired) return;
    try {
      const res = await fetchAuthMe();
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; user?: AuthUser };
      if (res.ok && data.success && data.user) {
        setUser(data.user);
        const hint =
          (typeof data.user.username === "string" && data.user.username) ||
          (typeof data.user.phone === "string" && data.user.phone) ||
          (typeof data.user.email === "string" && data.user.email) ||
          "";
        if (hint) {
          setPhone(hint);
          persistPhone(hint);
        }
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setUser(null);
        clearLegacyToken();
      }
    } catch {
      // ignore
    }
  }, [authRequired]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: identifier.trim(), password })
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      token?: string;
      user?: AuthUser;
      error?: string;
      detail?: string;
      message?: string;
    };
    if (!res.ok || !data.success || !data.token) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("登录状态已失效，请刷新页面后重新登录");
      }
      throw new Error(apiFailureMessage(data, `登录失败 ${res.status}`));
    }
    clearLegacyToken();
    setPhone(identifier.trim());
    persistPhone(identifier.trim());
    const u = data.user || {};
    setUser({ ...u });
    // 等待浏览器把登录 Set-Cookie 纳入同源存储，再拉 /me，减少紧随其后的 401。
    await new Promise((r) => setTimeout(r, 80));
    await refreshMe();
  }, [refreshMe]);

  const registerSendCode = useCallback(
    async (params: {
      email: string;
      username: string;
      inviteCode?: string;
    }): Promise<RegisterSendCodeResult> => {
      const res = await fetch("/api/auth/register/send-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: params.email.trim().toLowerCase(),
          username: params.username.trim(),
          invite_code: (params.inviteCode ?? "").trim()
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: string;
        message?: string;
        dev_otp_logged?: boolean;
      };
      if (!res.ok || !data.success) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("登录状态已失效，请刷新页面后重新登录");
        }
        throw new Error(apiFailureMessage(data, `发送失败 ${res.status}`));
      }
      if (data.dev_otp_logged) {
        return { devOtpLogged: true };
      }
      return {};
    },
    []
  );

  const registerVerifyCode = useCallback(async (params: { email: string; code: string }) => {
    const res = await fetch("/api/auth/register/verify-code", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: params.email.trim().toLowerCase(),
        code: params.code.replace(/\s/g, "")
      })
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      registration_ticket?: string;
      detail?: string;
    };
    if (!res.ok || !data.success || !data.registration_ticket) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("登录状态已失效，请刷新页面后重新登录");
      }
      throw new Error(apiFailureMessage(data, `验证失败 ${res.status}`));
    }
    return { registration_ticket: data.registration_ticket };
  }, []);

  const registerComplete = useCallback(
    async (params: { registration_ticket: string; password: string }) => {
      const res = await fetch("/api/auth/register/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registration_ticket: params.registration_ticket.trim(),
          password: params.password
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        token?: string;
        user?: AuthUser;
        detail?: string;
      };
      if (!res.ok || !data.success || !data.token) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("登录状态已失效，请刷新页面后重新登录");
        }
        throw new Error(apiFailureMessage(data, `注册失败 ${res.status}`));
      }
      clearLegacyToken();
      const u = data.user || {};
      const hint =
        (typeof u.username === "string" && u.username) ||
        (typeof u.email === "string" && u.email) ||
        (typeof u.phone === "string" && u.phone) ||
        "";
      if (hint) {
        setPhone(hint);
        persistPhone(hint);
      }
      setUser({ ...u });
      await new Promise((r) => setTimeout(r, 80));
      await refreshMe();
    },
    [refreshMe]
  );

  const logout = useCallback(
    async (options?: LogoutOptions) => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin"
        });
      } catch {
        // ignore
      }
      clearLegacyToken();
      setPhone("");
      persistPhone("");
      setUser(null);
      const redirectTo = options?.redirectTo === undefined ? "/" : options.redirectTo;
      if (redirectTo == null || redirectTo === "") return;
      if (typeof window !== "undefined" && window.location.pathname !== redirectTo) {
        router.replace(redirectTo);
      }
    },
    [router]
  );

  const getAuthHeaders = useCallback((): Record<string, string> => ({}), []);

  const ready = authRequired !== null && (authRequired === false || sessionResolved);

  const value = useMemo<AuthContextValue>(
    () => ({
      authRequired,
      token: "",
      phone,
      user,
      ready,
      refreshMe,
      login,
      registerSendCode,
      registerVerifyCode,
      registerComplete,
      logout,
      getAuthHeaders
    }),
    [
      authRequired,
      phone,
      user,
      ready,
      refreshMe,
      login,
      registerSendCode,
      registerVerifyCode,
      registerComplete,
      logout,
      getAuthHeaders
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** 用于 API `created_by` / 条件判断：优先 user_id，其次手机号、用户名、邮箱。 */
export function userAccountRef(user: AuthUser | null | undefined): string {
  if (!user || user.phone === "local") return "";
  const uid = typeof user.user_id === "string" ? user.user_id.trim() : "";
  if (uid) return uid;
  return String(user.phone || user.username || user.email || "").trim();
}

/**
 * 已登录真实账号（非本地 guest），且具备可识别身份（邮箱/手机/用户名/user_id）。
 * 订阅与支付宝下单以会话为准，不要求必须绑定手机号；勿仅用 `user.phone` 判断。
 */
export function isLoggedInAccountUser(user: AuthUser | null | undefined): boolean {
  if (!user || user.phone === "local") return false;
  if (typeof user.user_id === "string" && user.user_id.trim() !== "") return true;
  if (typeof user.email === "string" && user.email.trim() !== "") return true;
  if (typeof user.phone === "string" && user.phone !== "" && user.phone !== "local") return true;
  if (typeof user.username === "string" && user.username.trim() !== "") return true;
  return false;
}
