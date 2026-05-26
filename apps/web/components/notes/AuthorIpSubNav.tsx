"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "../../lib/cn";

const TABS = [
  { label: "概览", segment: "" },
  { label: "写一篇", segment: "/write" },
  { label: "素材", segment: "/materials" },
  { label: "场景", segment: "/scenes" },
  { label: "我的特色", segment: "/traits" }
] as const;

type Props = {
  displayName?: string;
};

export default function AuthorIpSubNav({ displayName }: Props) {
  const params = useParams();
  const pathname = usePathname() || "";
  const ipId = String(params?.ipId || "");
  const base = `/notes/author-ip/${ipId}`;

  return (
    <div className="mb-6 border-b border-line">
      <Link href="/notes/author-ip" className="text-sm text-muted hover:text-ink">
        ← 我的风格IP
      </Link>
      {displayName ? <p className="mt-1 text-lg font-semibold text-ink">{displayName}</p> : null}
      <nav className="mt-3 flex gap-4" aria-label="IP 工作台">
        {TABS.map((tab) => {
          const href = `${base}${tab.segment}`;
          const active =
            tab.segment === ""
              ? pathname === base || pathname === `${base}/`
              : pathname.startsWith(`${base}${tab.segment}`);
          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                "border-b-2 pb-2 text-sm transition-colors",
                active ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
