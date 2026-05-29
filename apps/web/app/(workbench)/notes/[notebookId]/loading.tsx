import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function NotesNotebookLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy aria-label="加载笔记本">
      <SkeletonLine className="h-8 w-48" />
      <SkeletonBlock className="h-64 w-full rounded-2xl" />
    </div>
  );
}
