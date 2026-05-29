import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function WorksLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-6xl px-3 py-8 sm:px-4" aria-busy aria-label="作品库加载中">
      <SkeletonLine className="mb-4 h-8 w-36" />
      <SkeletonLine className="mb-6 h-4 w-full max-w-md" />
      <div className="mb-4 flex gap-2">
        <SkeletonBlock className="h-9 w-20 rounded-full" />
        <SkeletonBlock className="h-9 w-20 rounded-full" />
        <SkeletonBlock className="h-9 w-24 rounded-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonBlock className="h-44 rounded-2xl" />
        <SkeletonBlock className="h-44 rounded-2xl" />
        <SkeletonBlock className="h-44 rounded-2xl" />
      </div>
    </main>
  );
}
