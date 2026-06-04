"use client";

import type { ComponentType, MouseEvent, ReactNode } from "react";
import SidebarNavLink from "../nav/SidebarNavLink";
import { dispatchNotesShowNotebookHub } from "../../lib/notesLastNotebook";
import { matchesNotesWorkbench, normalizePathname } from "../../lib/navPaths";

type NavItemShape = {
  href: string;
  label: string;
  short?: string;
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
  collapsed: boolean;
  NavIconBox: (p: { active: boolean; children: ReactNode }) => ReactNode;
};

/** 知识库一级导航：已在资料页时 soft 路由回 hub。 */
export default function NotesNavExpanded({ item, path, collapsed, NavIconBox }: Props) {
  const n = normalizePathname(path);
  const active = n === "/notes" || n.startsWith("/notes/");
  const Ic = item.Icon;
  const parentTip = item.linkTitle ?? item.label;
  const label = collapsed && item.short ? item.short : item.label;

  const onParentClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!matchesNotesWorkbench(path)) {
      // 从作品/创作等页进入知识库：不拦截，允许 Link 正常跳转 /notes
      return;
    }
    if (normalizePathname(path) !== "/notes") {
      // /notes/笔记本 等：软路由回 /notes hub
      return;
    }
    e.preventDefault();
    dispatchNotesShowNotebookHub();
  };

  return (
    <SidebarNavLink
      href="/notes"
      className={navButtonClass(active, collapsed)}
      title={parentTip}
      onClick={onParentClick}
    >
      <NavIconBox active={active}>
        <Ic />
      </NavIconBox>
      {!collapsed ? <span className="min-w-0 flex-1 truncate text-left leading-snug">{label}</span> : null}
    </SidebarNavLink>
  );
}
