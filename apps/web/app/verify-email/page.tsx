"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function VerifyEmailPage() {
  const sp = useSearchParams();
  const token = (sp?.get("token") ?? "").trim();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (!token) {
      setMsg("缺少 token 参数");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: string; error?: string };
      if (!res.ok || !data.success) {
        setMsg(String(data.detail || data.error || `验证失败 ${res.status}`));
        return;
      }
      setMsg("验证成功，请返回登录页使用邮箱登录。");
    } catch {
      setMsg("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold text-ink">邮箱验证</h1>
      <p className="mt-2 text-sm text-muted">{busy ? "正在验证…" : msg || "—"}</p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-brand underline underline-offset-2">
          返回首页登录
        </Link>
      </p>
    </main>
  );
}
