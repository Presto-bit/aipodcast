/** 笔记本卡片 / 工作台切换器共用主题色 */

export const NOTEBOOK_CARD_THEMES = [
  {
    card: "border-info/35 bg-gradient-to-br from-info/[0.08] via-surface to-info/[0.15]",
    iconWrap: "bg-info-soft text-info-ink",
    chip: "bg-info-soft/90 text-info-ink"
  },
  {
    card: "border-brand/35 bg-gradient-to-br from-brand/[0.08] via-surface to-brand/[0.15]",
    iconWrap: "bg-brand/15 text-brand",
    chip: "bg-brand/12 text-brand"
  },
  {
    card: "border-success/35 bg-gradient-to-br from-success/[0.08] via-surface to-success/[0.15]",
    iconWrap: "bg-success-soft text-success-ink",
    chip: "bg-success-soft/90 text-success-ink"
  },
  {
    card: "border-warning/35 bg-gradient-to-br from-warning/[0.08] via-surface to-warning/[0.15]",
    iconWrap: "bg-warning-soft text-warning-ink",
    chip: "bg-warning-soft/90 text-warning-ink"
  },
  {
    card: "border-danger/35 bg-gradient-to-br from-danger/[0.08] via-surface to-danger/[0.12]",
    iconWrap: "bg-danger-soft text-danger-ink",
    chip: "bg-danger-soft/90 text-danger-ink"
  },
  {
    card: "border-cta/35 bg-gradient-to-br from-cta/[0.08] via-surface to-cta/[0.15]",
    iconWrap: "bg-cta/15 text-cta",
    chip: "bg-cta/12 text-cta"
  }
] as const;

export type NotebookCardVisual = {
  themeIndex: number;
  iconIndex: number;
};

export function resolveNotebookCardVisual(
  picked: NotebookCardVisual | undefined
): { theme: (typeof NOTEBOOK_CARD_THEMES)[number]; iconIndex: number } {
  return {
    theme: NOTEBOOK_CARD_THEMES[picked?.themeIndex ?? 0],
    iconIndex: picked?.iconIndex ?? 0
  };
}
