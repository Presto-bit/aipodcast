"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";

type AdminNavIcon = "hub" | "users" | "models" | "usage" | "jobs" | "polish" | "matrix" | "pay";

function navHrefActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
  return false;
}

function NavIcon({ icon, active }: { icon: AdminNavIcon; active: boolean }) {
  const colorClass = active ? "text-brand" : "text-muted";
  if (icon === "hub") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`h-4 w-4 ${colorClass}`}>
        <path
          d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
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
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = String((user as { role?: string })?.role || "") === "admin";
  const navItems = [
    { href: "/admin/hub", label: "概览", desc: "快捷入口与说明", icon: "hub" as const },
    { href: "/admin/users", label: "用户管理", desc: "用户、角色与套餐", icon: "users" as const },
    { href: "/admin/models", label: "模型管理", desc: "模型与费用说明", icon: "models" as const },
    { href: "/admin/usage", label: "总览看板", desc: "总览/订单/用户/作品/告警", icon: "usage" as const },
    { href: "/admin/jobs", label: "创作记录", desc: "生成记录列表与详情", icon: "jobs" as const },
    { href: "/admin/tts-polish", label: "TTS 润色", desc: "AI 润色条款（单/双人）", icon: "polish" as const },
    { href: "/admin/subscription-matrix", label: "订阅矩阵", desc: "权限开关与计费口径（只读）", icon: "matrix" as const },
    { href: "/admin/subscription-pay", label: "订阅收银", desc: "内测价目与模拟支付", icon: "pay" as const },
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
    <div className={`grid min-h-0 gap-6 ${collapsed ? "md:grid-cols-[88px_minmax(0,1fr)]" : "md:grid-cols-[240px_minmax(0,1fr)]"}`}>
      <aside className="rounded-xl border border-line bg-surface/70 p-3 md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:self-start md:overflow-hidden">
        <div className={`mb-2 flex items-center ${collapsed ? "justify-center" : "justify-between"} px-2`}>
          {!collapsed ? (
            <div>
              <h2 className="text-sm font-semibold text-ink">后台管理</h2>
              <p className="mt-1 text-xs text-muted">在下方切换功能模块</p>
            </div>
          ) : null}
          <button
            type="button"
            className="hidden rounded-md border border-line bg-canvas/50 px-2 py-1 text-xs text-muted transition hover:border-brand/40 hover:text-ink md:inline-flex"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>
        <nav
          className="flex flex-col gap-1 pb-1 md:h-[calc(100%-2.75rem)] md:overflow-y-auto md:overflow-x-hidden md:pb-0"
          aria-label="后台功能导航"
        >
          <ul className="m-0 list-none space-y-1 p-0">
            {navItems.map((item) => {
              const isActive =
                item.href === "/admin/hub"
                  ? navHrefActive(pathname, item.href) || pathname === "/admin"
                  : navHrefActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={[
                      "group flex w-full items-center rounded-dawn-md py-2 text-sm transition-colors",
                      collapsed ? "justify-center px-0 md:px-1" : "gap-2.5 border-l-2 pl-1.5 pr-2",
                      collapsed
                        ? isActive
                          ? "bg-fill text-ink"
                          : "text-muted hover:bg-fill hover:text-ink"
                        : isActive
                          ? "border-brand/80 bg-fill text-ink"
                          : "border-transparent text-ink hover:bg-fill hover:text-ink",
                      collapsed && isActive ? "shadow-inset-brand" : "",
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
                    {!collapsed ? (
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block font-medium leading-snug text-ink">{item.label}</span>
                        <span className="mt-0.5 block text-xs font-normal leading-snug text-muted">{item.desc}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
