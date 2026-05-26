"use client";

import Link from "next/link";
import type { ComponentType, Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import { useI18n } from "../../lib/I18nContext";
import { matchesNotesAuthorIp, normalizePathname } from "../../lib/navPaths";

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

function navSubLinkClass(active: boolean): string {
  return [
    "group flex w-full items-center rounded-dawn-md border-l-2 py-1.5 pl-1.5 pr-2 text-left text-xs leading-snug text-inherit no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    active ? "border-brand/80 bg-fill text-ink" : "border-transparent text-muted hover:bg-fill hover:text-ink"
  ].join(" ");
}

type Props = {
  item: NavItemShape;
  path: string;
  notesSubNavExpanded: boolean;
  setNotesSubNavExpanded: Dispatch<SetStateAction<boolean>>;
  NavIconBox: (p: { active: boolean; children: ReactNode }) => ReactNode;
};

export default function NotesNavExpanded({
  item,
  path,
  notesSubNavExpanded,
  setNotesSubNavExpanded,
  NavIconBox
}: Props) {
  const { t } = useI18n();
  const n = normalizePathname(path);
  const onNotesHub = n === "/notes";
  const onAuthorIp = matchesNotesAuthorIp(path);
  const parentActive = onNotesHub || onAuthorIp;
  const Ic = item.Icon;
  const parentTip = item.linkTitle ?? item.label;

  const parentInner = (
    <>
      <NavIconBox active={parentActive}>
        <Ic />
      </NavIconBox>
      <span className="min-w-0 flex-1 truncate text-left leading-snug">{item.label}</span>
    </>
  );

  const onParentClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (notesSubNavExpanded) {
      e.preventDefault();
      setNotesSubNavExpanded(false);
    } else {
      setNotesSubNavExpanded(true);
    }
  };

  return (
    <div className="flex w-full flex-col gap-0.5">
      <Link
        href="/notes"
        prefetch={false}
        className={navButtonClass(parentActive, false)}
        title={parentTip}
        aria-expanded={notesSubNavExpanded}
        aria-controls="fym-notes-author-ip-subnav"
        onClick={onParentClick}
      >
        {parentInner}
      </Link>
      {notesSubNavExpanded ? (
        <div
          id="fym-notes-author-ip-subnav"
          role="group"
          aria-label={t("nav.notesSubNavGroup")}
          className="ml-10 flex flex-col gap-0.5"
        >
          <Link
            href="/notes/author-ip"
            prefetch={false}
            className={navSubLinkClass(onAuthorIp)}
            title={t("nav.authorIp")}
          >
            {t("nav.authorIp")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
