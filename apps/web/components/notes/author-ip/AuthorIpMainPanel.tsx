"use client";

import Link from "next/link";
import { useState } from "react";
import { needsAuthorIpColdStart, type AuthorIpItem, type AuthorIpMaterial } from "../../../lib/authorIp";
import AuthorIpStyleSummaryBar from "./AuthorIpStyleSummaryBar";

type Props = {
  item: AuthorIpItem;
  materials: AuthorIpMaterial[];
  writeHref: string;
  readOnly: boolean;
  onOpenProfile: () => void;
  onAddMaterial: () => void;
  onSetupPositioning: () => void;
  onDismissOnboarding: () => void;
  showOnboarding: boolean;
};

export default function AuthorIpMainPanel({
  item,
  materials,
  writeHref,
  readOnly,
  onOpenProfile,
  onAddMaterial,
  onSetupPositioning,
  onDismissOnboarding,
  showOnboarding
}: Props) {
  const [quickTopic, setQuickTopic] = useState("");
  const needsSetup = needsAuthorIpColdStart(item) && showOnboarding && !readOnly;

  const quickHref =
    quickTopic.trim().length > 0
      ? `${writeHref}?topic=${encodeURIComponent(quickTopic.trim())}`
      : writeHref;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
      <AuthorIpStyleSummaryBar item={item} materials={materials} onOpenProfile={onOpenProfile} />

      {needsSetup ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
          <p className="text-sm font-medium text-ink">完善风格后即可更好写作</p>
          <p className="mt-1 text-xs text-muted">上传 1 篇成稿或经历即可开始；也可先填简短定位。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-dawn-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
              onClick={onAddMaterial}
            >
              添加素材
            </button>
            <button
              type="button"
              className="rounded-dawn-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill"
              onClick={onSetupPositioning}
            >
              完善定位
            </button>
            <button type="button" className="text-xs text-muted hover:text-ink" onClick={onDismissOnboarding}>
              跳过
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-line/90 bg-fill/15 px-6 py-10 text-center">
        <p className="text-base font-semibold text-ink">用当前风格写一篇文章</p>
        <p className="mt-2 max-w-sm text-sm text-muted">系统会匹配你的口吻与经历；平时上传素材即可自动强化风格。</p>
        <Link
          href={writeHref}
          className="mt-6 inline-flex rounded-dawn-md bg-brand px-8 py-2.5 text-sm font-semibold text-brand-foreground hover:opacity-90"
        >
          开始写作
        </Link>
        <div className="mt-6 flex w-full max-w-md gap-2">
          <input
            className="min-w-0 flex-1 rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            placeholder="或先填主题，跳转写作页…"
            value={quickTopic}
            onChange={(e) => setQuickTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quickTopic.trim()) {
                window.location.href = quickHref;
              }
            }}
          />
          <Link
            href={quickHref}
            className="shrink-0 rounded-dawn-md border border-brand/40 px-4 py-2 text-sm font-medium text-brand hover:bg-brand/10"
          >
            去写
          </Link>
        </div>
      </div>
    </div>
  );
}
