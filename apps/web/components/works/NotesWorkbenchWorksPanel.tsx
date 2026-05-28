"use client";

import type { WorkItem } from "../../lib/worksTypes";
import WorksGroupedGalleryPanel from "./WorksGroupedGalleryPanel";

type Props = {
  works: WorkItem[];
  loading: boolean;
  fetchError: string;
  onDismissError: () => void;
  onWorkDeleted: () => void;
  pendingStudioWork?: WorkItem | null;
  pendingStudioSubtitle?: string;
};

/** 知识库工作台「我的作品」：分组紧凑列表 */
export default function NotesWorkbenchWorksPanel(props: Props) {
  return (
    <WorksGroupedGalleryPanel
      {...props}
      returnTo="/notes"
      maxPerGroup={3}
      emptyHint="暂无与本笔记本关联的成片；生成播客或文章后将显示在这里。"
    />
  );
}
