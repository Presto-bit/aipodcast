"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../lib/auth";

type AdminNavIcon = "users" | "models" | "usage" | "jobs" | "polish" | "matrix" | "pay";

function navHrefActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
  return false;
}

function NavIcon({ icon, active }: { icon: AdminNavIcon; active: boolean }) {
  const colorClass = active ? "text-brand" : "text-muted";
  if (icon === "users") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M16 19v-1a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v1M10.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6.5 0a2.5 2.5 0 1 0 0-5m2 13v-1a3 3 0 0 0-2-2.83"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === "models") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 7.5 12 4l8 3.5-8 3.5L4 7.5zm0 4 8 3.5 8-3.5M4 15.5 12 19l8-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === "usage") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 19h16M7 16v-3m5 3V8m5 8v-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === "polish") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 20l7.5-7.5M5 11l8-8 3 3-8 8-5 1 2-3.5zm9-9l2 2M15 12l3 3M6 18h12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === "matrix") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 6h4v4H4V6zm6 0h10v4H10V6zM4 14h4v4H4v-4zm6 0h10v4H10v-4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === "pay") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M4 10h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
      <path
        d="M3 8h18M7 4h10M6 12h12M10 16h4M6 20h12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const path = pathname ?? "";
  const isAdmin = String((user as { role?: string })?.role || "") === "admin";
  const navItems = [
    { href: "/admin/usage", label: "总览看板", desc: "总览/收支/订单/用户/作品/告警", icon: "usage" as const },
    { href: "/admin/users", label: "用户管理", desc: "用户与角色", icon: "users" as const },
    { href: "/admin/models", label: "模型管理", desc: "模型与费用说明", icon: "models" as const },
    { href: "/admin/jobs", label: "创作记录", desc: "生成记录列表与详情", icon: "jobs" as const },
    { href: "/admin/tts-polish", label: "TTS 润色", desc: "AI 润色条款（单/双人）", icon: "polish" as const },
  ];

  useEffect(() => {
    if (!ready) return;
    if (!isAdmin) router.replace("/");
  }, [ready, isAdmin, router]);

  if (!ready) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted">
        <p className="text-sm">加载中…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-muted">
        <p className="text-sm">需要管理员权限</p>
        <p className="text-xs text-muted">正在返回首页…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-col gap-4">
      <header className="sticky top-0 z-20 -mx-1 rounded-xl border border-line bg-surface/90 px-2 py-2 backdrop-blur-sm md:px-3">
        <div className="mb-2 flex flex-col gap-0.5 px-1 sm:px-2">
          <h2 className="text-sm font-semibold text-ink">后台管理</h2>
          <p className="text-[11px] text-muted">在下方标签切换功能模块</p>
        </div>
        <nav className="flex min-w-0 flex-wrap gap-1 sm:gap-2" aria-label="后台功能导航">
          {navItems.map((item) => {
            const isActive = navHrefActive(path, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                title={item.desc}
                className={[
                  "flex min-w-0 items-center gap-2 rounded-dawn-md border px-2.5 py-2 text-sm transition-colors sm:px-3",
                  isActive
                    ? "border-brand/50 bg-fill text-ink shadow-inset-brand"
                    : "border-transparent text-muted hover:border-line hover:bg-fill hover:text-ink",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-dawn-md transition-colors",
                    isActive
                      ? "bg-brand/18 text-brand shadow-inset-brand dark:bg-brand/22"
                      : "bg-fill text-muted group-hover:bg-track group-hover:text-ink",
                  ].join(" ")}
                >
                  <NavIcon icon={item.icon} active={isActive} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium leading-snug text-ink">{item.label}</span>
                  <span className="mt-0.5 hidden text-xs font-normal leading-snug text-muted sm:block">{item.desc}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </header>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
