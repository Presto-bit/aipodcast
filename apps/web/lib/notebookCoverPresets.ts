import type { CSSProperties } from "react";

/** 与编排器 NOTEBOOK_COVER_PRESET_IDS 一致；用于卡片背景（无图时的渐变预设） */
export const NOTEBOOK_COVER_PRESET_IDS = ["mist", "dawn", "slate", "forest"] as const;

export type NotebookCoverPresetId = (typeof NOTEBOOK_COVER_PRESET_IDS)[number];

export const NOTEBOOK_COVER_PRESET_STYLES: Record<NotebookCoverPresetId, CSSProperties> = {
  mist: {
    backgroundImage: "linear-gradient(135deg, #dbeafe 0%, #e0e7ff 45%, #f5f3ff 100%)"
  },
  dawn: {
    backgroundImage: "linear-gradient(135deg, #ffedd5 0%, #fecdd3 40%, #fde68a 100%)"
  },
  slate: {
    backgroundImage: "linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 50%, #94a3b8 100%)"
  },
  forest: {
    backgroundImage: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 45%, #6ee7b7 100%)"
  }
};

export function isNotebookCoverPresetId(id: string | null | undefined): id is NotebookCoverPresetId {
  return Boolean(id && (NOTEBOOK_COVER_PRESET_IDS as readonly string[]).includes(id));
}
