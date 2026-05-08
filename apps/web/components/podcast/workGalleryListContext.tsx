"use client";

import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { createContext, useContext } from "react";
import type { WorkItem } from "../../lib/worksTypes";
import type { RssPublication } from "../../lib/api";
import type { PodcastWorkRow } from "./workGalleryListShared";

export type WorkGalleryListContextValue = {
  variant: "podcast" | "tts" | "notes" | "notes_studio" | "all";
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
  progress01: number;
  durationSec: number;
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
