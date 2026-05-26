"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type AuthorIpItem, fetchAuthorIpItem } from "../../../../../lib/authorIp";

export default function AuthorIpLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname() || "";
  const ipId = String(params?.ipId || "");
  const base = `/notes/author-ip/${ipId}`;
  const isWorkbench = pathname === base || pathname === `${base}/`;
  const isWrite = pathname.startsWith(`${base}/write`);

  const [item, setItem] = useState<AuthorIpItem | null>(null);

  const load = useCallback(async () => {
    if (!ipId || isWorkbench) return;
    try {
      setItem(await fetchAuthorIpItem(ipId));
    } catch {
      setItem(null);
    }
  }, [ipId, isWorkbench]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isWorkbench) {
    return (
      <div className="mx-auto h-screen max-w-[1440px] overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 border-b border-line pb-4">
        <Link href="/notes/author-ip" className="text-sm text-muted hover:text-ink">
          ← 个人风格 IP
        </Link>
        {isWrite ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link href={base} className="text-sm text-brand hover:underline">
              IP 资料
            </Link>
            <span className="text-muted">/</span>
            <span className="text-lg font-semibold text-ink">{item?.displayName ?? "…"} · 写一篇</span>
          </div>
        ) : (
          item?.displayName ? <p className="mt-1 text-lg font-semibold text-ink">{item.displayName}</p> : null
        )}
      </div>
      {children}
    </div>
  );
}
