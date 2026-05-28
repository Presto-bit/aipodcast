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

/** 与 `NOTEBOOK_ICON_COUNT`（icons/brand/notebooks）保持一致 */
const NOTEBOOK_CARD_ICON_COUNT = 8;

function fnv1aHash32(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按笔记本名称生成稳定主题与图标，避免刷新或账号键切换后随机变化 */
export function stableNotebookVisualFromName(name: string): NotebookCardVisual {
  const key = String(name || "").trim() || "default";
  const u = fnv1aHash32(key);
  return {
    themeIndex: u % NOTEBOOK_CARD_THEMES.length,
    iconIndex: Math.floor(u / NOTEBOOK_CARD_THEMES.length) % NOTEBOOK_CARD_ICON_COUNT
  };
}
