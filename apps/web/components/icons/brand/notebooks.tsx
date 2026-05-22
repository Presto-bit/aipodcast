import type { SVGProps } from "react";
import { ICON_STROKE, ICON_VIEW_BOX } from "../constants";

type Props = SVGProps<SVGSVGElement>;

function nb(props: Props) {
  return {
    width: props.width ?? 20,
    height: props.height ?? 20,
    viewBox: ICON_VIEW_BOX,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: ICON_STROKE,
    "aria-hidden": props["aria-hidden"] ?? true,
    ...props
  };
}

/** 蓝皮书 */
export function IconNotebookBook(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M6 4h9a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4z" strokeLinejoin="round" />
      <path d="M8 4v16" strokeLinecap="round" opacity={0.35} />
      <path d="M11 9h5M11 13h4" strokeLinecap="round" />
    </svg>
  );
}

/** 橙皮书 / 期刊 */
export function IconNotebookJournal(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M5 5h14v14H5V5z" strokeLinejoin="round" />
      <path d="M9 5v14" strokeLinecap="round" opacity={0.35} />
      <path d="M12 9h5M12 12h4M12 15h5" strokeLinecap="round" />
    </svg>
  );
}

/** 文件夹 */
export function IconNotebookFolder(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
      <path d="M4 11h16" strokeLinecap="round" opacity={0.35} />
    </svg>
  );
}

/** 思考 / 脑 */
export function IconNotebookBrain(props: Props) {
  return (
    <svg {...nb(props)}>
      <path
        d="M9 4a3 3 0 0 0-2.2 5 3 3 0 0 0 0 6 3.5 3.5 0 0 0 3.5 3.5M15 4a3 3 0 0 1 2.2 5 3 3 0 0 1 0 6 3.5 3.5 0 0 1-3.5 3.5"
        strokeLinecap="round"
      />
      <path d="M12 4v16" strokeLinecap="round" opacity={0.25} />
    </svg>
  );
}

/** 实验 */
export function IconNotebookLab(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M10 3v6l-4 8h12l-4-8V3" strokeLinejoin="round" />
      <path d="M8 17h8" strokeLinecap="round" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 魔法棒 */
export function IconNotebookWand(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M15 4l5 5M4 20l8-8" strokeLinecap="round" />
      <path d="M6 6l1.5 1.5M4 10l2 .5M6 14l-.5 2" strokeLinecap="round" opacity={0.7} />
    </svg>
  );
}

/** 卫星 / 探索 */
export function IconNotebookSatellite(props: Props) {
  return (
    <svg {...nb(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
      <path d="M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" strokeLinecap="round" opacity={0.55} />
    </svg>
  );
}

/** 笔记 */
export function IconNotebookMemo(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M8 4h7l3 3v13H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" strokeLinejoin="round" />
      <path d="M15 4v3h3" strokeLinecap="round" opacity={0.45} />
      <path d="M10 12h6M10 16h4" strokeLinecap="round" />
    </svg>
  );
}

export const NOTEBOOK_ICON_COUNT = 8;

const NOTEBOOK_ICON_LIST = [
  IconNotebookBook,
  IconNotebookJournal,
  IconNotebookFolder,
  IconNotebookBrain,
  IconNotebookLab,
  IconNotebookWand,
  IconNotebookSatellite,
  IconNotebookMemo
] as const;

export function NotebookIcon({ index, ...props }: Props & { index: number }) {
  const i = ((Math.floor(index) % NOTEBOOK_ICON_COUNT) + NOTEBOOK_ICON_COUNT) % NOTEBOOK_ICON_COUNT;
  const C = NOTEBOOK_ICON_LIST[i]!;
  return <C {...props} />;
}
