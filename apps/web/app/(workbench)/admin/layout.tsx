"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../../lib/auth";
import { WORKBENCH_HOME_PATH } from "../../../lib/navPaths";
import { AdminNavIcon, type AdminNavIconId } from "../../../components/icons";

function navHrefActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
  return false;
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
    { href: "/admin/log-management", label: "日志管理", desc: "日志开关、TTL、采样与审计", icon: "logs" as const },
    { href: "/admin/jobs", label: "创作记录", desc: "全站任务与操作", icon: "jobs" as const },
    { href: "/admin/works", label: "作品管理", desc: "全站成片列表与试听", icon: "works" as const },
    { href: "/admin/tts-polish", label: "TTS 润色", desc: "口语润色条款（单/双人）", icon: "polish" as const },
  ];

  useEffect(() => {
    if (!ready) return;
    if (!isAdmin) router.replace(WORKBENCH_HOME_PATH);
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
                  <AdminNavIcon icon={item.icon as AdminNavIconId} active={isActive} />
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
