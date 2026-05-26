"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MoreHorizontal } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import { maturityLabel } from "./utils";

type Props = {
  item: AuthorIpItem;
  busy: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  writeHref: string;
};

export default function AuthorIpWorkbenchHeader({
  item,
  busy,
  onRename,
  onDuplicate,
  onDelete,
  writeHref
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canDelete = !item.isSystemSeed && !item.isTemplate;
  const canRename = !item.isTemplate;

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-ip-header-menu]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
      <Link href="/notes/author-ip" className="shrink-0 text-sm text-muted hover:text-brand">
        ← 个人风格 IP
      </Link>
      <span className="truncate text-base font-semibold text-ink">{item.displayName}</span>
      <span
        className="shrink-0 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand"
        title="成熟度"
      >
        {maturityLabel(String(item.maturity))}
      </span>
      {item.isTemplate ? (
        <span className="shrink-0 text-[10px] text-cta">示例</span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Link
          href={writeHref}
          className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
        >
          写一篇
        </Link>
        <div className="relative" data-ip-header-menu>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-fill"
            aria-label="更多"
            aria-expanded={menuOpen}
            disabled={busy}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
              {canRename ? (
                <button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-fill" onClick={() => { setMenuOpen(false); onRename(); }}>
                  改名
                </button>
              ) : null}
              <button type="button" className="block w-full px-2 py-1.5 text-left hover:bg-fill" onClick={() => { setMenuOpen(false); onDuplicate(); }}>
                复制
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                >
                  删除
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
