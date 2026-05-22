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
      <rect x="6" y="5" width="11" height="14" rx="2" strokeLinejoin="round" />
      <path d="M9 5v14" strokeLinecap="round" opacity={0.35} />
      <path d="M11.5 10h4.5M11.5 13.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

/** 期刊 */
export function IconNotebookJournal(props: Props) {
  return (
    <svg {...nb(props)}>
      <rect x="5" y="5" width="14" height="14" rx="2" strokeLinejoin="round" />
      <path d="M9 5v14" strokeLinecap="round" opacity={0.35} />
      <path d="M12 9.5h4.5M12 12.5h3.5M12 15.5h4.5" strokeLinecap="round" />
      <path d="M5 10.5h14" strokeLinecap="round" opacity={0.22} />
    </svg>
  );
}

/** 文件夹 */
export function IconNotebookFolder(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M4 8h6.5l1.8 1.8H18a1.8 1.8 0 0 1 1.8 1.8v7.4a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8V8z" strokeLinejoin="round" />
      <path d="M4 12.2h16" strokeLinecap="round" opacity={0.35} />
    </svg>
  );
}

/** 思考 */
export function IconNotebookBrain(props: Props) {
  return (
    <svg {...nb(props)}>
      <rect x="5" y="5" width="14" height="14" rx="3" opacity={0.28} />
      <path
        d="M9.2 7.5a2.6 2.6 0 0 0-1.8 4.2 2.6 2.6 0 0 0 0 5 3 3 0 0 0 3 3M14.8 7.5a2.6 2.6 0 0 1 1.8 4.2 2.6 2.6 0 0 1 0 5 3 3 0 0 1-3 3"
        strokeLinecap="round"
      />
      <path d="M12 7.5v9" strokeLinecap="round" opacity={0.25} />
    </svg>
  );
}

/** 实验 */
export function IconNotebookLab(props: Props) {
  return (
    <svg {...nb(props)}>
      <path d="M10.5 4v5.5L6.5 18h11l-4-8.5V4" strokeLinejoin="round" />
      <path d="M8.5 18h7" strokeLinecap="round" opacity={0.45} />
      <circle cx="12" cy="14.2" r="1.1" fill="currentColor" stroke="none" opacity={0.75} />
    </svg>
  );
}

/** 魔法 */
export function IconNotebookWand(props: Props) {
  return (
    <svg {...nb(props)}>
      <rect x="5" y="5" width="14" height="14" rx="3.5" opacity={0.28} />
      <path d="M15 6.5 7.5 18" strokeLinecap="round" />
      <circle cx="16.8" cy="6.2" r="1" fill="currentColor" stroke="none" opacity={0.7} />
      <path d="M6.5 7.5l1.2 1.2M5 10.5l1.8.4" strokeLinecap="round" opacity={0.55} />
    </svg>
  );
}

/** 探索 */
export function IconNotebookSatellite(props: Props) {
  return (
    <svg {...nb(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7" opacity={0.28} />
      <path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" strokeLinecap="round" opacity={0.55} />
    </svg>
  );
}

/** 备忘 */
export function IconNotebookMemo(props: Props) {
  return (
    <svg {...nb(props)}>
      <path
        d="M8.5 5.5h6l2 2v11.5H9a1.5 1.5 0 0 1-1.5-1.5V5.5z"
        strokeLinejoin="round"
        opacity={0.4}
      />
      <path d="M7 7h6l2 2v9.5a1.5 1.5 0 0 1-1.5 1.5H8.5a1.5 1.5 0 0 1-1.5-1.5V7z" strokeLinejoin="round" />
      <path d="M10 12.5h5.5M10 16h4" strokeLinecap="round" />
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
