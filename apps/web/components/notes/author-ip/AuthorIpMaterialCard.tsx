"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "../../icons";
import type { AuthorIpMaterial } from "../../../lib/authorIp";
import { cn } from "../../../lib/cn";

const BAR_COLOR: Record<string, string> = {
  experience_card: "bg-teal-600",
  published: "bg-amber-600",
  draft: "bg-slate-400"
};

type Props = {
  material: AuthorIpMaterial;
  readOnly: boolean;
  busy: boolean;
  onDelete: (noteId: string) => void;
};

export default function AuthorIpMaterialCard({ material, readOnly, busy, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const barClass = BAR_COLOR[material.materialType] || "bg-line";
  const len = material.bodyLength ?? 0;
  const widthPct = Math.min(100, (len / 2000) * 100);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-material-card-menu]")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <li
      className="group relative rounded-xl border border-line/80 bg-surface px-3 py-2.5 shadow-sm"
      title={material.preview || material.title}
    >
      <div className={cn("absolute bottom-0 left-0 top-0 w-1 rounded-l-xl", barClass)} aria-hidden />
      <div className="flex items-start gap-2 pl-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{material.title}</p>
        {!readOnly ? (
          <div className="relative shrink-0" data-material-card-menu>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-fill"
              aria-label="更多"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-30 mt-0.5 min-w-[6rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
                <button
                  type="button"
                  className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(material.noteId);
                  }}
                >
                  删除
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-2 pl-2">
        <div className="h-0.5 rounded-full bg-line/50">
          <div className={cn("h-full rounded-full opacity-70", barClass)} style={{ width: `${widthPct}%` }} />
        </div>
      </div>
    </li>
  );
}
