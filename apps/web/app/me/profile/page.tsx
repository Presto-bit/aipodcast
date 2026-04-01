"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { useI18n } from "../../../lib/I18nContext";

export default function MeProfilePage() {
  const { t } = useI18n();
  const { ready, authRequired, logout, user, login, register } = useAuth();
  const showLogout = Boolean(user && user.phone && user.phone !== "local");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "login") {
        await login(authPhone.trim(), authPassword);
      } else {
        await register(authPhone.trim(), authPassword, inviteCode.trim());
      }
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setAuthBusy(false);
    }
  }

  if (!ready) {
    return <p className="py-12 text-center text-sm text-muted">正在加载…</p>;
  }

  const displayName =
    typeof user?.display_name === "string" && user.display_name.trim() ? user.display_name.trim() : "—";
  const role = String((user as { role?: string })?.role || "").trim() || "—";
  const plan = typeof user?.plan === "string" ? user.plan : "—";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <h2 className="text-sm font-semibold text-ink">注册信息</h2>
        <p className="mt-1 text-xs text-muted">当前账号在系统中的登记信息。</p>
        {showLogout && user ? (
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <dt className="text-muted">手机号</dt>
              <dd className="font-mono text-ink">{String(user.phone)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <dt className="text-muted">{t("settings.displayName")}</dt>
              <dd className="text-ink">{displayName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <dt className="text-muted">当前方案</dt>
              <dd className="font-mono text-ink">{plan}</dd>
            </div>
            {role !== "—" ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">角色</dt>
                <dd className="text-ink">{role}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-muted">登录后可查看注册手机号与展示信息。</p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card-sm">
        <h2 className="text-sm font-semibold text-ink">{t("settings.logoutTitle")}</h2>
        {authRequired && showLogout && !user ? <p className="mt-2 text-sm text-muted">正在恢复登录状态…</p> : null}
        {showLogout && user ? (
          <>
            <p className="mt-1 text-[11px] text-muted">{t("settings.logoutHint")}</p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-line bg-fill px-4 py-3 text-sm font-medium text-ink transition hover:bg-canvas sm:w-auto sm:min-w-[8rem]"
              onClick={() => void logout({ redirectTo: null })}
            >
              {t("footer.logout")}
            </button>
          </>
        ) : null}
        {authRequired && !showLogout ? (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-muted">
              用手机号登录或注册；也可以先到{" "}
              <Link href="/" className="text-brand underline underline-offset-2 hover:opacity-90">
                首页
              </Link>
              。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${authMode === "login" ? "bg-brand text-white" : "border border-line bg-fill"}`}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                }}
              >
                登录
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${authMode === "register" ? "bg-brand text-white" : "border border-line bg-fill"}`}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                }}
              >
                注册
              </button>
            </div>
            <form className="space-y-3" onSubmit={submitAuth}>
              <input
                className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                placeholder="手机号"
                value={authPhone}
                onChange={(e) => setAuthPhone(e.target.value)}
                required
                autoComplete="tel"
              />
              <input
                className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                type="password"
                placeholder="密码"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
              />
              {authMode === "register" ? (
                <input
                  className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                  placeholder="邀请码"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                />
              ) : null}
              {authError ? <p className="text-sm text-rose-500 dark:text-rose-400">{authError}</p> : null}
              <button
                type="submit"
                className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50 sm:w-auto sm:min-w-[10rem]"
                disabled={authBusy}
              >
                {authBusy ? "正在提交…" : authMode === "login" ? "登录" : "注册"}
              </button>
            </form>
          </div>
        ) : null}
        {!authRequired && !showLogout ? (
          <p className="mt-2 text-[11px] text-muted">当前环境未开启登录，可直接体验；若管理员开启了账号登录，这里会出现登录入口。</p>
        ) : null}
      </section>
    </div>
  );
}
