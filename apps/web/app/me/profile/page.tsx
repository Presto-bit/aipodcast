"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/auth";
import { isRegisterEmailFormatOk } from "../../../lib/registerEmail";
import { useI18n } from "../../../lib/I18nContext";

export default function MeProfilePage() {
  const { t } = useI18n();
  const { ready, authRequired, logout, user, login, registerSendCode, registerVerifyCode, registerComplete, refreshMe } =
    useAuth();
  const showLogout = Boolean(
    user && user.phone !== "local" && !!(user.user_id || user.phone || user.email || user.username)
  );
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regCodeSent, setRegCodeSent] = useState(false);
  const [regOtp, setRegOtp] = useState("");
  const [regDispatchHint, setRegDispatchHint] = useState("");
  const [regSendCodeBusy, setRegSendCodeBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");
  const [regA11ySuccess, setRegA11ySuccess] = useState("");
  const [usernameEdit, setUsernameEdit] = useState("");
  const [usernameSaveBusy, setUsernameSaveBusy] = useState(false);
  const [usernameSaveMsg, setUsernameSaveMsg] = useState("");

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (authMode === "login") {
      setAuthBusy(true);
      setAuthError("");
      try {
        await login(authPhone.trim(), authPassword);
      } catch (err) {
        setAuthError(String(err instanceof Error ? err.message : err));
      } finally {
        setAuthBusy(false);
      }
      return;
    }
    if (!regCodeSent) {
      setAuthError("请先发送验证码");
      return;
    }
    if (!regOtp.trim()) {
      setAuthError("请填写验证码");
      return;
    }
    if (authPassword !== regPasswordConfirm) {
      setAuthError("两次输入的密码不一致");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { registration_ticket } = await registerVerifyCode({
        email: regEmail.trim().toLowerCase(),
        code: regOtp
      });
      await registerComplete({ registration_ticket, password: authPassword });
      setRegCodeSent(false);
      setRegOtp("");
      setRegDispatchHint("");
      setAuthPassword("");
      setRegPasswordConfirm("");
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendRegisterCode() {
    setAuthError("");
    setRegA11ySuccess("");
    if (!isRegisterEmailFormatOk(regEmail)) {
      setAuthError("请填写有效的邮箱地址（需含 @ 与域名后缀，如 name@example.com）");
      return;
    }
    setRegSendCodeBusy(true);
    try {
      const sendRes = await registerSendCode({
        email: regEmail.trim().toLowerCase(),
        username: regUsername.trim()
      });
      setRegCodeSent(true);
      setRegOtp("");
      setRegDispatchHint(
        sendRes.devOtpLogged
          ? "当前为日志发码：请到运行编排器的终端查看 [auth] register OTP 行（生产请配置 SMTP 并关闭 FYV_AUTH_EMAIL_LOG_TOKEN）。"
          : ""
      );
      setRegA11ySuccess(
        sendRes.devOtpLogged
          ? "验证码已生成。当前为日志模式，未发送真实邮件，请到服务器日志查看。"
          : "验证码已发送，请查收邮箱。"
      );
    } catch (err) {
      setAuthError(String(err instanceof Error ? err.message : err));
    } finally {
      setRegSendCodeBusy(false);
    }
  }

  useEffect(() => {
    if (!regA11ySuccess) return;
    const t = window.setTimeout(() => setRegA11ySuccess(""), 5000);
    return () => window.clearTimeout(t);
  }, [regA11ySuccess]);

  useEffect(() => {
    if (!ready || !authRequired) return;
    if (!user || user.phone === "local") return;
    if (!(user.user_id || user.phone || user.email || user.username)) return;
    void refreshMe();
  }, [
    ready,
    authRequired,
    refreshMe,
    user?.user_id,
    user?.phone,
    user?.email,
    user?.username
  ]);

  useEffect(() => {
    if (!user || user.phone === "local") return;
    const hint = String(user.username ?? user.phone ?? "").trim();
    setUsernameEdit(hint);
  }, [user?.username, user?.phone, user?.user_id]);

  async function saveUsername() {
    const next = usernameEdit.trim();
    if (!next) {
      setUsernameSaveMsg("用户名不能为空");
      return;
    }
    setUsernameSaveBusy(true);
    setUsernameSaveMsg("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: next })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) {
        setUsernameSaveMsg(String(data.detail || `保存失败 ${res.status}`));
        return;
      }
      setUsernameSaveMsg("已保存");
      await refreshMe();
      window.setTimeout(() => setUsernameSaveMsg(""), 2000);
    } catch {
      setUsernameSaveMsg("请求失败，请稍后重试");
    } finally {
      setUsernameSaveBusy(false);
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
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
        <h2 className="text-sm font-semibold text-ink">注册信息</h2>
        <p className="mt-1 text-xs text-muted">当前账号在系统中的登记信息。</p>
        {showLogout && user ? (
          <dl className="mt-4 space-y-3 text-sm">
            {user.phone ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">手机号</dt>
                <dd className="font-mono text-ink">{String(user.phone)}</dd>
              </div>
            ) : null}
            {user.user_id ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">用户 ID</dt>
                <dd className="font-mono text-xs text-ink">{String(user.user_id)}</dd>
              </div>
            ) : null}
            {user.email ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">邮箱</dt>
                <dd className="font-mono text-xs text-ink">{String(user.email)}</dd>
              </div>
            ) : null}
            {user.username ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">用户名</dt>
                <dd className="font-mono text-ink">{String(user.username)}</dd>
              </div>
            ) : null}
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
          <p className="mt-4 text-sm text-muted">登录后可查看账号标识与展示信息。</p>
        )}
      </section>

      {showLogout && user ? (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-ink">登录用户名</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            用于「用户名」登录，须为 3～32 位字母、数字或下划线。注册时填写的用户名也可在此修改（须未被占用）。
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm font-mono text-ink sm:max-w-md"
              value={usernameEdit}
              onChange={(e) => setUsernameEdit(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              maxLength={32}
            />
            <button
              type="button"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
              disabled={usernameSaveBusy}
              onClick={() => void saveUsername()}
            >
              {usernameSaveBusy ? "保存中…" : "保存"}
            </button>
          </div>
          {usernameSaveMsg ? <p className="mt-2 text-xs text-muted">{usernameSaveMsg}</p> : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${authMode === "login" ? "bg-brand text-brand-foreground" : "border border-line bg-fill"}`}
                onClick={() => {
                  setAuthMode("login");
                  setAuthError("");
                  setRegCodeSent(false);
                  setRegOtp("");
                  setRegDispatchHint("");
                  setRegPasswordConfirm("");
                }}
              >
                登录
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${authMode === "register" ? "bg-brand text-brand-foreground" : "border border-line bg-fill"}`}
                onClick={() => {
                  setAuthMode("register");
                  setAuthError("");
                  setRegCodeSent(false);
                  setRegOtp("");
                  setRegDispatchHint("");
                  setAuthPassword("");
                  setRegPasswordConfirm("");
                }}
              >
                注册
              </button>
            </div>
            <form className="space-y-3" onSubmit={submitAuth}>
              {authMode === "login" ? (
                <input
                  className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                  placeholder="手机号、邮箱或用户名"
                  value={authPhone}
                  onChange={(e) => setAuthPhone(e.target.value)}
                  required
                  autoComplete="username"
                  aria-label="账号"
                />
              ) : null}
              {authMode === "register" ? (
                <>
                  <input
                    className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                    placeholder="用户名（3～32 位字母、数字或下划线）"
                    value={regUsername}
                    onChange={(e) => {
                      setRegUsername(e.target.value);
                      setRegCodeSent(false);
                      setRegDispatchHint("");
                      setRegPasswordConfirm("");
                    }}
                    required
                    minLength={3}
                    maxLength={32}
                    autoComplete="username"
                    aria-label="用户名"
                  />
                  <input
                    className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                    type="email"
                    placeholder="邮箱"
                    value={regEmail}
                    onChange={(e) => {
                      setRegEmail(e.target.value);
                      setRegCodeSent(false);
                      setRegDispatchHint("");
                      setRegPasswordConfirm("");
                    }}
                    required
                    autoComplete="email"
                    aria-label="邮箱"
                  />
                  <div className="flex w-full items-stretch overflow-hidden rounded-lg border border-line bg-fill shadow-sm transition focus-within:border-brand focus-within:ring-1 focus-within:ring-brand/25">
                    <input
                      className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-ink outline-none ring-0 placeholder:text-muted focus:ring-0"
                      inputMode="numeric"
                      placeholder="请输入 6 位验证码"
                      value={regOtp}
                      onChange={(e) => setRegOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      autoComplete="one-time-code"
                      aria-label="验证码"
                    />
                    <button
                      type="button"
                      className="shrink-0 border-l border-line bg-canvas px-3 py-2 text-sm text-ink transition hover:bg-fill disabled:opacity-50"
                      disabled={regSendCodeBusy}
                      onClick={() => void sendRegisterCode()}
                    >
                      {regSendCodeBusy ? "提交中…" : regCodeSent ? (regDispatchHint ? "已生成" : "已发送") : "发送验证码"}
                    </button>
                  </div>
                  {regDispatchHint ? <p className="text-xs text-muted">{regDispatchHint}</p> : null}
                  <input
                    className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                    type="password"
                    placeholder="密码（至少 6 位）"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    aria-label="密码"
                  />
                  <input
                    className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                    type="password"
                    placeholder="确认密码"
                    value={regPasswordConfirm}
                    onChange={(e) => setRegPasswordConfirm(e.target.value)}
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    aria-label="确认密码"
                  />
                </>
              ) : null}
              {authMode === "login" ? (
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
              ) : null}
              {authError ? (
                <p className="text-sm text-danger-ink" role="alert" aria-live="assertive">
                  {authError}
                </p>
              ) : null}
              {authMode === "register" && regA11ySuccess ? (
                <span className="sr-only" aria-live="polite">
                  {regA11ySuccess}
                </span>
              ) : null}
              <button
                type="submit"
                className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50 sm:w-auto sm:min-w-[10rem]"
                disabled={authBusy}
              >
                {authBusy ? "正在提交…" : authMode === "login" ? "登录" : "注册"}
              </button>
              {authMode === "login" ? (
                <p className="text-center text-xs">
                  <Link href="/forgot-password" className="text-brand underline underline-offset-2 hover:opacity-90">
                    忘记密码
                  </Link>
                </p>
              ) : null}
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
