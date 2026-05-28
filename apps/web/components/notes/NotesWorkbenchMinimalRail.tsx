"use client";

import Link from "next/link";
import { IconCreate, IconHome, IconNotes } from "../icons";
import BrandGlyph from "../brand/BrandGlyph";
import { dispatchNotesShowNotebookHub } from "../../lib/notesLastNotebook";
import { WORKBENCH_HOME_PATH } from "../../lib/navPaths";

const RAIL_BTN =
  "flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-fill hover:text-ink";

type Props = {
  homeLabel: string;
  notesLabel: string;
  createLabel: string;
};

/** 笔记本工作台：48px 图标轨（桌面）；返回列表由页内顶栏「知识库」承担 */
export default function NotesWorkbenchMinimalRail({ homeLabel, notesLabel, createLabel }: Props) {
  return (
    <aside
      id="fym-app-sidebar-root"
      data-fym-app-sidebar
      data-fym-notes-minimal-rail
      className="fixed left-0 top-0 z-[100000] flex h-svh w-12 min-w-[48px] max-w-[48px] flex-col items-center border-r border-line bg-surface/95 py-2 backdrop-blur-sm"
      aria-label="工作台导航"
    >
      <Link
        href="/"
        prefetch={false}
        className="mb-1 flex shrink-0 rounded-lg p-0.5 outline-offset-2 hover:bg-fill/60 focus-visible:ring-2 focus-visible:ring-brand/35"
        aria-label="首页"
      >
        <BrandGlyph size={32} />
      </Link>
      <nav className="flex flex-col items-center gap-0.5" aria-label="快捷入口">
        <a href={WORKBENCH_HOME_PATH} className={RAIL_BTN} title={homeLabel} aria-label={homeLabel}>
          <IconHome width={20} height={20} aria-hidden />
        </a>
        <button
          type="button"
          className={RAIL_BTN}
          title={notesLabel}
          aria-label={notesLabel}
          onClick={() => dispatchNotesShowNotebookHub()}
        >
          <IconNotes width={20} height={20} aria-hidden />
        </button>
        <a href="/create" className={RAIL_BTN} title={createLabel} aria-label={createLabel}>
          <IconCreate width={20} height={20} aria-hidden />
        </a>
      </nav>
    </aside>
  );
}
