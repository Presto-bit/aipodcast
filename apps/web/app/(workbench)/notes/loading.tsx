import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function NotesLoading() {
  return (
    <main
      className="min-h-[60vh] w-full"
      data-notes-workbench=""
      aria-busy
      aria-label="知识库加载中"
    >
      <div className="w-full space-y-4 px-3 py-6 sm:px-4">
        <SkeletonLine className="h-8 w-40" />
        <SkeletonLine className="h-4 w-full max-w-lg" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonBlock className="h-36 rounded-2xl" />
          <SkeletonBlock className="h-36 rounded-2xl" />
          <SkeletonBlock className="h-36 rounded-2xl" />
        </div>
      </div>
    </main>
  );
}
