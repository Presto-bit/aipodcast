"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isLoggedInAccountUser, useAuth, userAccountRef } from "../../lib/auth";
import { WORKBENCH_SCRIM_Z_CLASS } from "../../lib/workbenchOverlays";
import { useWorkbenchOverlayDismiss } from "../../lib/useWorkbenchOverlayDismiss";

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
 * 首次登录（按账号维度）可选短引导：资料 → 创作 → 作品。
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

  const prevPathRef = useRef(pathname);

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

  /** 用户已通过侧栏切页：关闭引导并本会话不再弹出，避免全屏层挡住导航 */
  useEffect(() => {
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    setOpen((wasOpen) => {
      if (!wasOpen) return false;
      try {
        sessionStorage.setItem(SESSION_SNOOZE_KEY, "1");
      } catch {
        /* ignore */
      }
      return false;
    });
  }, [pathname]);

  const dismissSnooze = useCallback(() => dismiss(false, true), [dismiss]);
  useWorkbenchOverlayDismiss(open, dismissSnooze);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fym-workspace-scrim ${WORKBENCH_SCRIM_Z_CLASS} flex items-end justify-center bg-ink/40 p-4 sm:items-center`}
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
          三步上手：① 在<strong className="text-ink">资料</strong>添加资料（可一键创建示例笔记本）→ ② 侧栏
          <strong className="text-ink">创作工具</strong>生成播客或语音 → ③ 在
          <strong className="text-ink">作品</strong>
          查看成片与导出。长任务完成后会站内提醒，无需一直等待。
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink">
          <li>资料：整理素材，供创作引用</li>
          <li>创作工具：播客、语音合成与后期精修</li>
          <li>作品：收听、下载与发布</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/notes"
            className="inline-flex flex-1 min-w-[7rem] items-center justify-center rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:opacity-95"
            onClick={() => dismiss(true)}
          >
            去资料
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
    </div>,
    document.body
  );
}
