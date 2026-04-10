"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export default function ResetPasswordPage() {
  const sp = useSearchParams();
  const tokenFromUrl = (sp.get("token") || "").trim();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (!tokenFromUrl) {
      setErr("链接无效，请从邮件中打开完整链接");
      return;
    }
    if (password.length < 6) {
      setErr("密码至少 6 位");
      return;
    }
    if (password !== password2) {
      setErr("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenFromUrl, new_password: password })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string };
      if (!res.ok || !data.success) {
        setErr(String(data.detail || `重置失败 ${res.status}`));
        return;
      }
      setMsg("密码已更新，请使用新密码登录。");
      setPassword("");
      setPassword2("");
    } catch {
      setErr("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold text-ink">设置新密码</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        请使用邮件中的完整链接进入本页。链接短时有效且仅能使用一次（具体以提示为准）。
      </p>
      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
        <input
          className="w-full rounded border border-line bg-canvas p-3 text-sm"
          type="password"
          placeholder="新密码（至少 6 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
        <input
          className="w-full rounded border border-line bg-canvas p-3 text-sm"
          type="password"
          placeholder="确认新密码"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
        {err ? <p className="text-sm text-danger-ink">{err}</p> : null}
        {msg ? <p className="text-sm text-success-ink" role="status">{msg}</p> : null}
        <button
          type="submit"
          className="w-full rounded bg-brand px-4 py-2 text-sm text-brand-foreground disabled:opacity-50"
          disabled={busy || !tokenFromUrl}
        >
          {busy ? "提交中…" : "确认重置"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/" className="text-brand underline underline-offset-2 hover:opacity-90">
          返回首页登录
        </Link>
      </p>
    </main>
  );
}
