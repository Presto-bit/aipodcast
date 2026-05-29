"use client";

import dynamic from "next/dynamic";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";

/** 按需加载 NotesPageMain，首进知识库时先出 hub 骨架，避免软路由 URL 已变但主包未就绪白屏。 */
export default dynamic(() => import("./NotesPageMain"), {
  ssr: false,
  loading: () => (
    <main
      className="mx-auto min-h-0 w-full max-w-[min(100%,1800px)] px-3 pb-10 sm:px-4"
      aria-busy
      aria-label="加载知识库"
    >
      <div className="mb-4 flex gap-1 rounded-xl border border-line/60 bg-fill/35 p-1">
        <SkeletonLine className="h-10 min-w-0 flex-1 rounded-lg" />
        <SkeletonLine className="h-10 min-w-0 flex-1 rounded-lg" />
      </div>
      <div className="mt-4 space-y-3">
        <SkeletonLine className="h-4 w-full max-w-md" />
        <div className="flex gap-3 overflow-x-auto pb-2">
          <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
          <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
          <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
        </div>
      </div>
    </main>
  )
});
