"use client";

import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";

type Props = { children: ReactNode };

/** /clip 路由：需已登录；未登录时由上层路由或中间件处理（此处不渲染子树）。 */
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

  return <>{children}</>;
}
