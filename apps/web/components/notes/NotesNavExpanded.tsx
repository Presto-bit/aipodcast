"use client";

import type { ComponentType, ReactNode } from "react";
import SidebarNavLink from "../nav/SidebarNavLink";
import { normalizePathname } from "../../lib/navPaths";

type NavItemShape = {
  href: string;
  label: string;
  linkTitle?: string;
  Icon: ComponentType<object>;
};

function navButtonClass(active: boolean, collapsed: boolean): string {
  return [
    "group flex w-full items-center gap-2 rounded-dawn-md border text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    collapsed ? "justify-center border-transparent px-2 py-2" : "border-transparent px-2.5 py-2",
    active ? "bg-fill text-ink" : "text-muted hover:bg-fill hover:text-ink"
  ].join(" ");
}

type Props = {
  item: NavItemShape;
  path: string;
  notesSubNavExpanded: boolean;
  setNotesSubNavExpanded: (v: boolean) => void;
  NavIconBox: (p: { active: boolean; children: ReactNode }) => ReactNode;
};

/** 知识库一级导航（v6：个人风格 IP 已迁入笔记本，不再展示二级入口） */
export default function NotesNavExpanded({
  item,
  path,
  NavIconBox
}: Props) {
  const n = normalizePathname(path);
  const active = n === "/notes" || n.startsWith("/notes/");
  const Ic = item.Icon;
  const parentTip = item.linkTitle ?? item.label;

  return (
    <SidebarNavLink href="/notes" className={navButtonClass(active, false)} title={parentTip}>
      <NavIconBox active={active}>
        <Ic />
      </NavIconBox>
      <span className="min-w-0 flex-1 truncate text-left leading-snug">{item.label}</span>
    </SidebarNavLink>
  );
}
