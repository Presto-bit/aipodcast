"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

const NotesPageMain = dynamic(() => import("../../../../components/notes/NotesPageMain"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy aria-label="加载笔记本">
      <SkeletonLine className="h-8 w-48" />
      <SkeletonBlock className="h-64 w-full rounded-2xl" />
    </div>
  )
});

export default function NotesNotebookPage() {
  const params = useParams();
  const notebookId = String(params?.notebookId || "").trim();
  return <NotesPageMain initialNotebookId={notebookId || null} />;
}
