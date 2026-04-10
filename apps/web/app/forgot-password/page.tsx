"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) {
        setErr(String(data.detail || `请求失败 ${res.status}`));
        return;
      }
      setMsg(data.message || "若该邮箱已注册且已完成验证，您将在几分钟内收到重置密码邮件。");
    } catch {
      setErr("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold text-ink">重置密码</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        请输入账号绑定的、已通过验证的邮箱。系统将发送重置链接（约 30 分钟内有效，以邮件说明为准）。
      </p>
      <form className="mt-6 space-y-3" onSubmit={onSubmit}>
        <input
          className="w-full rounded border border-line bg-canvas p-3 text-sm"
          type="email"
          placeholder="绑定且已验证的邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        {err ? <p className="text-sm text-danger-ink">{err}</p> : null}
        {msg ? <p className="text-sm text-success-ink" role="status">{msg}</p> : null}
        <button
          type="submit"
          className="w-full rounded bg-brand px-4 py-2 text-sm text-brand-foreground disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "发送中…" : "发送重置链接"}
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
