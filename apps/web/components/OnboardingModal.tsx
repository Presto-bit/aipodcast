"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";

const STORAGE_KEY = "fym_onboarding_v1_seen";

export default function OnboardingModal() {
  const { user, ready } = useAuth();
  const isAdmin = ready && String((user as { role?: string })?.role || "") === "admin";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
      setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-2xl">
        <h2 id="onb-title" className="text-lg font-semibold text-ink">
          欢迎使用 FindingYourVoice
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          先用<strong className="text-ink">笔记</strong>整理好素材，再到{" "}
          <strong className="text-ink">AI 播客</strong> 或{" "}
          <strong className="text-ink">文本转语音</strong>
          里生成节目。生成需要一点时间，可在<strong className="text-ink">创作记录</strong>
          里查看进度，完成后在<strong className="text-ink">我的作品</strong>收听或下载。
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-muted">
          {isAdmin ? (
            <li>
              侧栏<strong>会员与套餐</strong>可查看方案与本月用量。
            </li>
          ) : null}
          <li>若生成失败，可在详情页重试；仍无法解决时，欢迎发邮件联系客服（邮件里会自动附上记录编号）。</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/notes"
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand min-[360px]:flex-none"
            onClick={dismiss}
          >
            去写笔记
          </Link>
          <button
            type="button"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-fill min-[360px]:flex-none"
            onClick={dismiss}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
