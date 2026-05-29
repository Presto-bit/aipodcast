"use client";

import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { createContext, useContext } from "react";
import type { WorkItem } from "../../lib/worksTypes";
import type { RssPublication } from "../../lib/api";
import type { PodcastWorkRow } from "./workGalleryListShared";

export type WorkGalleryRowLayout = "grid" | "compact" | "script-list" | "active";

export type ScriptCardDensity = "full" | "mini";

export type WorkGalleryListContextValue = {
  variant: "podcast" | "tts" | "notes" | "notes_studio" | "all";
  rowLayout: WorkGalleryRowLayout;
  /** 文稿杂志卡：侧栏限条数时用 mini */
  scriptCardDensity: ScriptCardDensity;
  /** 知识库/侧栏等紧凑网格（2 列迷你卡） */
  scriptGridSingleColumn: boolean;
  useNotesStyleCards: boolean;
  useCompactAllLayout: boolean;
  enableBatchActions: boolean;
  batchMode: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  pendingStudioWork: WorkItem | null;
  pendingStudioSubtitle: string;
  activeJobId: string | null;
  isPlayingAudio: boolean;
  activePlayError: string | null;
  playErrorById: Record<string, string>;
  hydratedDurationSec: Record<string, number>;
  publicationsByJobId: Record<string, RssPublication[]>;
  menuOpenId: string | null;
  setMenuOpenId: Dispatch<SetStateAction<string | null>>;
  menuWrapRef: RefObject<HTMLDivElement | null>;
  renameJobId: string | null;
  renameDraft: string;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  commitRename: () => void;
  setRenameJobId: Dispatch<SetStateAction<string | null>>;
  coverBustById: Record<string, number>;
  audioLoadingId: string | null;
  togglePlay: (jobId: string, displayTitle: string, audioOpts?: { usePodcastPublicTemplateListen?: boolean }) => void;
  worksNavAuthorDisplay: string;
  workDetailReturnTo?: string;
  goToSharePage: (work: PodcastWorkRow) => void;
  zipBusy: string | null;
  openRename: (jobId: string, current: string) => void;
  requestDelete: (jobId: string) => void;
  onReuseTemplate: (id: string, opts?: { publicTemplate?: boolean }) => Promise<void>;
  renderDownloadGated: (
    row: PodcastWorkRow,
    jobId: string,
    unlockedClassName: string,
    label: ReactNode,
    gatedExtras?: {
      lockedLinkClassName?: string;
      lockedLabelClassName?: string;
      onLockedNavigate?: () => void;
    }
  ) => ReactNode;
  /** 与 jobOwnerUserId 比对，判断模板作品是否对当前用户锁定变更 */
  viewerAccountRef: string;
  /** 「我的作品 → 进行中」：底部用停止/删除替换下载/修改文稿 */
  activeQueueCardActions: boolean;
  stopBusyId: string | null;
  requestStopActiveJob: (jobId: string) => void;
  copyManuscriptBusyId: string | null;
  requestCopyManuscript: (jobId: string, work?: Pick<WorkItem, "scriptText" | "scriptCharCount" | "status">) => void;
  quickReadWorkId: string | null;
  openQuickRead: (work: PodcastWorkRow) => void;
  closeQuickRead: () => void;
};

export type WorkGalleryActivePlayback = {
  progress01: number;
  durationSec: number;
};

const WorkGalleryListContext = createContext<WorkGalleryListContextValue | null>(null);

export function WorkGalleryListProvider({
  value,
  children
}: {
  value: WorkGalleryListContextValue;
  children: React.ReactNode;
}) {
  return <WorkGalleryListContext.Provider value={value}>{children}</WorkGalleryListContext.Provider>;
}

export function useWorkGalleryListContext(): WorkGalleryListContextValue {
  const v = useContext(WorkGalleryListContext);
  if (!v) throw new Error("useWorkGalleryListContext must be used under WorkGalleryListProvider");
  return v;
}
