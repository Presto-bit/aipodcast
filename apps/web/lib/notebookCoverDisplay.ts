import type { CSSProperties } from "react";
import { isNotebookCoverPresetId, NOTEBOOK_COVER_PRESET_STYLES } from "./notebookCoverPresets";

export type NotebookCoverMeta = {
  coverMode?: string;
  coverPresetId?: string | null;
  hasUploadThumb?: boolean;
  autoCoverNoteId?: string | null;
};

export function notebookCoverImageUrl(
  notebookName: string,
  cover: NotebookCoverMeta | undefined,
  role: "mine" | "popular",
  ownerUserId?: string
): string | undefined {
  if (!cover) return undefined;
  const mode = (cover.coverMode || "auto").toLowerCase();
  const encNb = encodeURIComponent(notebookName);
  /** 列表与卡片仅展示用户上传的封面图；其它模式由 UI 用主题色与图标占位 */
  if (mode === "upload" && cover.hasUploadThumb) {
    if (role === "popular" && ownerUserId) {
      const q = new URLSearchParams({
        ownerUserId,
        notebook: notebookName,
        variant: "thumb"
      });
      return `/api/notebooks/cover-public?${q.toString()}`;
    }
    return `/api/notebooks/${encNb}/cover?variant=thumb`;
  }
  return undefined;
}

export function notebookCoverPresetStyle(cover: NotebookCoverMeta | undefined): CSSProperties | undefined {
  if (!cover) return undefined;
  if ((cover.coverMode || "auto").toLowerCase() !== "preset") return undefined;
  const id = cover.coverPresetId;
  if (!isNotebookCoverPresetId(id)) return undefined;
  return NOTEBOOK_COVER_PRESET_STYLES[id];
}
