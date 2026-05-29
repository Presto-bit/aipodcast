import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function AdminUsageLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-6xl px-4 py-8" aria-busy aria-label="用量看板加载中">
      <SkeletonLine className="h-8 w-40" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SkeletonBlock className="h-20 rounded-xl" />
        <SkeletonBlock className="h-20 rounded-xl" />
        <SkeletonBlock className="h-20 rounded-xl" />
        <SkeletonBlock className="h-20 rounded-xl" />
      </div>
      <SkeletonBlock className="mt-6 h-72 w-full rounded-xl" />
    </main>
  );
}
