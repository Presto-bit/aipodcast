"use client";

import Link from "next/link";
import { WORKBENCH_STUDIO_PATH } from "../../lib/navPaths";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";

const REGISTER_HREF = `/register?returnTo=${encodeURIComponent(WORKBENCH_STUDIO_PATH)}`;

/** 营销页顶栏：仅鉴权相关按钮需 client 化，主体内容由 Server Component 渲染。 */
export default function MarketingAuthNav() {
  const { ready, authRequired, user } = useAuth();
  const loggedIn = ready && authRequired && isLoggedInAccountUser(user);

  return (
    <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-3" aria-label="营销页导航">
      <Link
        href="/subscription"
        prefetch={false}
        className="text-sm font-medium text-muted transition hover:text-ink"
      >
        套餐与余额
      </Link>
      {loggedIn ? (
        <Link
          href={WORKBENCH_STUDIO_PATH}
          className="inline-flex items-center rounded-lg bg-cta px-3.5 py-2 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90 sm:px-4"
        >
          进入工作台
        </Link>
      ) : (
        <>
          <Link
            href={`/login?returnTo=${encodeURIComponent(WORKBENCH_STUDIO_PATH)}`}
            prefetch={false}
            className="text-sm font-medium text-muted transition hover:text-ink"
          >
            登录
          </Link>
          <Link
            href={REGISTER_HREF}
            prefetch={false}
            className="inline-flex items-center rounded-lg bg-cta px-3.5 py-2 text-sm font-medium text-cta-foreground shadow-soft transition hover:bg-cta/90 sm:px-4"
          >
            注册
          </Link>
        </>
      )}
    </nav>
  );
}
