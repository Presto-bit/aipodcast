"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../../lib/auth";
import { consumePostAuthReturnTo } from "../../../lib/authReturnTo";
import { WORKBENCH_DEFAULT_PATH } from "../../../lib/navPaths";

export default function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get("returnTo") ?? null;
  const { ready, authRequired, user, login } = useAuth();
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const registerHref = returnTo
    ? `/register?returnTo=${encodeURIComponent(returnTo)}`
    : "/register";

  useEffect(() => {
    if (!ready || !authRequired) return;
    if (!isLoggedInAccountUser(user)) return;
    const target = consumePostAuthReturnTo(returnTo);
    router.replace(target || WORKBENCH_DEFAULT_PATH);
  }, [ready, authRequired, user, router, returnTo]);

  async function submitLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      await login(authPhone.trim(), authPassword);
      const target = consumePostAuthReturnTo(returnTo);
      if (target) router.replace(target);
      else router.replace(WORKBENCH_DEFAULT_PATH);
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setAuthBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-sm text-muted">正在加载…</p>
      </main>
    );
  }

  if (!authRequired) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-sm text-muted">当前环境未开启登录，可直接使用各功能。</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
          返回首页
        </Link>
      </main>
    );
  }

  if (isLoggedInAccountUser(user)) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-sm text-muted">正在跳转…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-md px-4 pb-16 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">登录</h1>
      <p className="mt-2 text-sm text-muted">使用手机号、邮箱或用户名登录</p>

      <form className="mt-6 space-y-3" onSubmit={(e) => void submitLogin(e)}>
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="手机号、邮箱或用户名"
          value={authPhone}
          onChange={(e) => setAuthPhone(e.target.value)}
          required
          autoComplete="username"
          aria-label="账号"
        />
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          type="password"
          placeholder="密码"
          value={authPassword}
          onChange={(e) => setAuthPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="current-password"
          aria-label="密码"
        />
        {authError ? (
          <p className="text-sm text-danger-ink" role="alert" aria-live="assertive">
            {authError}
          </p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
          disabled={authBusy}
        >
          {authBusy ? "正在提交…" : "登录"}
        </button>
        <p className="text-center text-xs">
          <Link href="/forgot-password" className="text-brand underline underline-offset-2 hover:opacity-90">
            忘记密码
          </Link>
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        没有账号？{" "}
        <Link href={registerHref} className="font-medium text-brand hover:underline">
          前往注册
        </Link>
      </p>
    </main>
  );
}
