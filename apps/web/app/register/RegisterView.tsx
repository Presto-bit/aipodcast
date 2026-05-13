"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { consumePostAuthReturnTo } from "../../lib/authReturnTo";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";
import { isRegisterEmailFormatOk } from "../../lib/registerEmail";

export default function RegisterView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get("returnTo") ?? null;
  const { ready, authRequired, user, registerSendCode, registerVerifyCode, registerComplete } = useAuth();
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regCodeSent, setRegCodeSent] = useState(false);
  const [regOtp, setRegOtp] = useState("");
  const [regDispatchHint, setRegDispatchHint] = useState("");
  const [regSendCodeBusy, setRegSendCodeBusy] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [regA11ySuccess, setRegA11ySuccess] = useState("");

  const loginHref = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";

  useEffect(() => {
    if (!ready || !authRequired) return;
    if (!isLoggedInAccountUser(user)) return;
    const target = consumePostAuthReturnTo(returnTo);
    router.replace(target || WORKBENCH_HOME_PATH);
  }, [ready, authRequired, user, router, returnTo]);

  useEffect(() => {
    if (!regA11ySuccess) return;
    const t = window.setTimeout(() => setRegA11ySuccess(""), 5000);
    return () => window.clearTimeout(t);
  }, [regA11ySuccess]);

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

  async function submitRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
      const target = consumePostAuthReturnTo(returnTo);
      if (target) router.replace(target);
      else router.replace(WORKBENCH_HOME_PATH);
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
        <p className="text-sm text-muted">当前环境未开启登录。</p>
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
      <h1 className="text-2xl font-semibold tracking-tight text-ink">注册</h1>
      <p className="mt-2 text-sm text-muted">使用邮箱与验证码创建账号</p>

      <form className="mt-6 space-y-3" onSubmit={(e) => void submitRegister(e)}>
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
        <input
          className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="账号名称（3～32 位字母、数字或下划线）"
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
          aria-label="账号名称"
        />
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
        {authError ? (
          <p className="text-sm text-danger-ink" role="alert" aria-live="assertive">
            {authError}
          </p>
        ) : null}
        {regA11ySuccess ? (
          <span className="sr-only" aria-live="polite">
            {regA11ySuccess}
          </span>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
          disabled={authBusy}
        >
          {authBusy ? "正在提交…" : "注册"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        已有账号？{" "}
        <Link href={loginHref} className="font-medium text-brand hover:underline">
          去登录
        </Link>
      </p>
    </main>
  );
}
