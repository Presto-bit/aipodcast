"use client";

import dynamic from "next/dynamic";
import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

const NotesPageMain = dynamic(() => import("../../../components/notes/NotesPageMain"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy aria-label="加载知识库">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonBlock className="h-40 w-full rounded-2xl" />
      <SkeletonBlock className="h-40 w-full rounded-2xl" />
    </div>
  )
});

export default function NotesPage() {
  return <NotesPageMain />;
}
