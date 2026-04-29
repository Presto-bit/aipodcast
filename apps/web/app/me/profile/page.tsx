"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isLoggedInAccountUser, useAuth } from "../../../lib/auth";
import { isRegisterEmailFormatOk } from "../../../lib/registerEmail";
import { useI18n } from "../../../lib/I18nContext";
import { useTheme } from "../../../lib/ThemeContext";
import { consumePostAuthReturnTo } from "../../../lib/authReturnTo";
import ChangePasswordModal from "../../../components/ui/ChangePasswordModal";
import InlineTextPrompt from "../../../components/ui/InlineTextPrompt";

export default function MeProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { ready, authRequired, logout, user, login, registerSendCode, registerVerifyCode, registerComplete, refreshMe } =
    useAuth();
  const showLogout = isLoggedInAccountUser(user);
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
  const [nicknamePromptOpen, setNicknamePromptOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameErr, setNicknameErr] = useState("");
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdOk, setPwdOk] = useState("");

  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (authMode === "login") {
      setAuthBusy(true);
      setAuthError("");
      try {
        await login(authPhone.trim(), authPassword);
        const target = consumePostAuthReturnTo(searchParams.get("returnTo"));
        if (target) router.replace(target);
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
      const target = consumePostAuthReturnTo(searchParams.get("returnTo"));
      if (target) router.replace(target);
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
    if (!pwdOk) return;
    const t = window.setTimeout(() => setPwdOk(""), 5000);
    return () => window.clearTimeout(t);
  }, [pwdOk]);

  useEffect(() => {
    if (!ready || !authRequired) return;
    if (!user || user.phone === "local") return;
    if (!(user.user_id || user.phone || user.email || user.username)) return;
    void refreshMe();
  }, [
    ready,
    authRequired,
    refreshMe,
    user,
    user?.user_id,
    user?.phone,
    user?.email,
  ]);

  const displayName =
    typeof user?.display_name === "string" && user.display_name.trim() ? user.display_name.trim() : "—";

  const startNicknameEdit = useCallback(() => {
    if (!showLogout || !user) return;
    setNicknameErr("");
    setNicknameDraft(displayName === "—" ? "" : displayName);
    setNicknamePromptOpen(true);
  }, [showLogout, user, displayName]);

  const saveNickname = useCallback(async () => {
    const v = nicknameDraft.trim();
    if (!v) {
      setNicknameErr("昵称不能为空");
      return;
    }
    if (v.length > 48) {
      setNicknameErr("昵称不超过 48 字");
      return;
    }
    setNicknameBusy(true);
    setNicknameErr("");
    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: v })
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        const d = data.detail;
        const msg = typeof d === "string" && d.trim() ? d.trim() : `更新失败（${res.status}）`;
        throw new Error(msg);
      }
      setNicknamePromptOpen(false);
      await refreshMe();
    } catch (e) {
      setNicknameErr(e instanceof Error ? e.message : String(e));
    } finally {
      setNicknameBusy(false);
    }
  }, [nicknameDraft, refreshMe]);

  const applyPasswordChange = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    if (!res.ok) {
      const d = data.detail;
      const msg = typeof d === "string" && d.trim() ? d.trim() : `修改失败（${res.status}）`;
      throw new Error(msg);
    }
  }, []);

  if (!ready) {
    return <p className="py-12 text-center text-sm text-muted">正在加载…</p>;
  }

  const accountName =
    typeof user?.username === "string" && user.username.trim() ? user.username.trim() : "—";

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
      <h2 className="text-sm font-semibold text-ink">个人资料与账号</h2>

      {showLogout && user ? (
        <div className="mt-5">
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <dt className="text-muted">账号名称</dt>
              <dd className="font-mono text-ink">{accountName}</dd>
            </div>
            {user.email ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <dt className="text-muted">邮箱</dt>
                <dd className="font-mono text-xs text-ink">{String(user.email)}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <dt className="text-muted">{t("settings.displayName")}</dt>
              <dd
                className="cursor-default text-ink underline decoration-dotted decoration-muted/60 underline-offset-2 select-none"
                title="双击修改昵称"
                onDoubleClick={startNicknameEdit}
              >
                {displayName}
              </dd>
            </div>
          </dl>
          {nicknamePromptOpen ? (
            <div className="mt-4 border-t border-line pt-3">
              <InlineTextPrompt
                open
                title="修改昵称"
                value={nicknameDraft}
                onChange={setNicknameDraft}
                onSubmit={() => {
                  if (nicknameBusy) return;
                  void saveNickname();
                }}
                onCancel={() => {
                  if (nicknameBusy) return;
                  setNicknamePromptOpen(false);
                  setNicknameErr("");
                }}
                submitLabel={nicknameBusy ? "保存中…" : "保存"}
                cancelLabel="取消"
                placeholder="1～48 字"
                closeOnOutsideClick={false}
              />
              {nicknameErr ? (
                <p className="mt-2 text-xs text-danger-ink" role="alert">
                  {nicknameErr}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">
          {authRequired ? "登录后可查看账号标识、修改密码与展示信息。" : "当前环境未开启登录，可直接体验。"}
        </p>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("settings.account")}</h3>
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs font-medium text-ink">{t("settings.theme")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${theme === "light" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                onClick={() => setTheme("light")}
              >
                {t("theme.light")}
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${theme === "dark" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                onClick={() => setTheme("dark")}
              >
                {t("theme.dark")}
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-ink">{t("settings.language")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${lang === "zh" ? "border-brand bg-fill" : "border-line"}`}
                onClick={() => setLang("zh")}
              >
                {t("lang.zh")}
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${lang === "en" ? "border-brand bg-fill" : "border-line"}`}
                onClick={() => setLang("en")}
              >
                {t("lang.en")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        {authRequired && showLogout && !user ? <p className="mt-2 text-sm text-muted">正在恢复登录状态…</p> : null}
        {showLogout && user ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="w-full rounded-lg border border-line bg-fill px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas sm:w-auto sm:min-w-[8rem]"
              onClick={() => {
                setPwdOk("");
                setPwdModalOpen(true);
              }}
            >
              修改密码
            </button>
            <ChangePasswordModal
              open={pwdModalOpen}
              onClose={() => setPwdModalOpen(false)}
              onSuccess={() => setPwdOk("密码已更新")}
              applyChange={applyPasswordChange}
            />
            {pwdOk ? (
              <p className="text-sm text-brand" role="status">
                {pwdOk}
              </p>
            ) : null}
            <button
              type="button"
              className="w-full rounded-lg border border-line bg-fill px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-canvas sm:w-auto sm:min-w-[8rem]"
              onClick={() => void logout({ redirectTo: "/" })}
            >
              {t("footer.logout")}
            </button>
          </div>
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
      </div>
    </div>
  );
}
