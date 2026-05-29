import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function NotesTrashLoading() {
  return (
    <main className="mx-auto min-h-[50vh] w-full max-w-4xl px-4 py-8" aria-busy aria-label="回收站加载中">
      <SkeletonLine className="h-8 w-28" />
      <SkeletonBlock className="mt-6 h-12 w-full rounded-lg" />
      <SkeletonBlock className="mt-4 h-64 w-full rounded-xl" />
    </main>
  );
}
