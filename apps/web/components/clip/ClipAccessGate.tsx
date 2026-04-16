"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { canUseClipStudio } from "../../lib/clipNavAccess";
import { useI18n } from "../../lib/I18nContext";

type Props = { children: ReactNode };

/**
 * /clip 路由：与侧栏一致，默认仅管理员可用；NEXT_PUBLIC_CLIP_NAV_PUBLIC=1 时对已登录用户开放。
 */
export default function ClipAccessGate({ children }: Props) {
  const { ready, user } = useAuth();
  const { t } = useI18n();

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted">
        <p className="text-sm">{t("clip.loading")}</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const role = String((user as { role?: string }).role || "");
  if (!canUseClipStudio(role)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-ink">{t("clip.access.deniedTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted">{t("clip.access.deniedHint")}</p>
        <div>
          <Link href="/" className="text-sm text-brand hover:underline">
            {t("clip.access.backHome")}
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
