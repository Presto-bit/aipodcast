"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../../lib/auth";

const STORAGE_KEY = "fym_first_login_coach_done_v1";
const SESSION_SNOOZE_KEY = "fym_first_login_coach_snooze_v1";

function readDoneMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeDone(accountKey: string) {
  try {
    const m = readDoneMap();
    m[accountKey] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/**
 * 首次登录（按账号维度）可选短引导：知识库 → 创作 → 作品；与首页「欢迎回来」互补。
 */
export default function FirstLoginCoach() {
  const pathname = usePathname() || "";
  const { ready, user } = useAuth();
  const [open, setOpen] = useState(false);

  const dismiss = useCallback(
    (remember: boolean, snoozeSession?: boolean) => {
      if (snoozeSession) {
        try {
          sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      const key = userAccountRef(user);
      if (remember && key) writeDone(key);
      setOpen(false);
    },
    [user]
  );

  useEffect(() => {
    if (!ready || !isLoggedInAccountUser(user)) return;
    if (pathname.startsWith("/login") || pathname.startsWith("/register")) return;
    try {
      if (sessionStorage.getItem(SESSION_SNOOZE_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    const key = userAccountRef(user);
    if (!key) return;
    if (readDoneMap()[key]) return;
    const t = window.setTimeout(() => setOpen(true), 800);
    return () => window.clearTimeout(t);
  }, [ready, user, pathname]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200000] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fym-coach-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(false, true);
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h2 id="fym-coach-title" className="text-lg font-semibold text-ink">
          欢迎使用 Presto
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          三步上手：① 在<strong className="text-ink">知识库</strong>新建笔记本并添加资料 → ② 打开
          <strong className="text-ink">创作播客</strong>输入主题或勾选资料 → ③ 在<strong className="text-ink">我的作品</strong>
          查看进度与成片。长任务无需一直停在当前页。
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink">
          <li>知识库：整理素材，供创作引用</li>
          <li>创作：一键播客或语音合成</li>
          <li>作品：收听、下载与发布</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/notes"
            className="inline-flex flex-1 min-w-[7rem] items-center justify-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-95"
            onClick={() => dismiss(true)}
          >
            去知识库
          </Link>
          <Link
            href="/create"
            className="inline-flex flex-1 min-w-[7rem] items-center justify-center rounded-lg border border-line bg-fill px-3 py-2 text-sm font-medium text-ink hover:bg-fill/80"
            onClick={() => dismiss(true)}
          >
            去创作
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Link
            href="/help"
            className="text-xs font-medium text-brand underline-offset-2 hover:underline"
            onClick={() => dismiss(false, true)}
          >
            使用帮助
          </Link>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-fill hover:text-ink"
            onClick={() => dismiss(false, true)}
          >
            稍后再说
          </button>
            <button
              type="button"
              className="rounded-lg bg-cta px-3 py-1.5 text-xs font-medium text-cta-foreground hover:bg-cta/90"
              onClick={() => dismiss(true)}
            >
              知道了，不再提示
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
