"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isLoggedInAccountUser, useAuth } from "../../../../lib/auth";
import { useI18n } from "../../../../lib/I18nContext";
import { useTheme } from "../../../../lib/ThemeContext";
import ChangePasswordModal from "../../../../components/ui/ChangePasswordModal";
import InlineTextPrompt from "../../../../components/ui/InlineTextPrompt";

export default function MeProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { ready, authRequired, logout, user, refreshMe } = useAuth();
  const showLogout = isLoggedInAccountUser(user);
  const [nicknamePromptOpen, setNicknamePromptOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [nicknameBusy, setNicknameBusy] = useState(false);
  const [nicknameErr, setNicknameErr] = useState("");
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdOk, setPwdOk] = useState("");

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

  const profileReturnPath = useMemo(() => {
    const qs = searchParams?.toString() || "";
    return `/me/profile${qs ? `?${qs}` : ""}`;
  }, [searchParams]);

  useEffect(() => {
    if (!ready || !authRequired) return;
    if (isLoggedInAccountUser(user)) return;
    const loginUrl = `/login?returnTo=${encodeURIComponent(profileReturnPath)}`;
    router.replace(loginUrl);
  }, [ready, authRequired, user, router, profileReturnPath]);

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

  if (authRequired && !isLoggedInAccountUser(user)) {
    return <p className="py-12 text-center text-sm text-muted">正在前往登录…</p>;
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
              onClick={() =>
                void logout({
                  redirectTo: `/login?returnTo=${encodeURIComponent(profileReturnPath)}`
                })
              }
            >
              {t("footer.logout")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
