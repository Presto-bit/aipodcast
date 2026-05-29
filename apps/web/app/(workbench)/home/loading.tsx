import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function HomeLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8" aria-busy aria-label="工作台首页加载中">
      <SkeletonLine className="h-9 w-56 max-w-[85%]" />
      <SkeletonLine className="mt-3 h-4 w-full max-w-lg" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonBlock className="h-28 rounded-2xl" />
        <SkeletonBlock className="h-28 rounded-2xl" />
        <SkeletonBlock className="h-28 rounded-2xl" />
      </div>
      <SkeletonBlock className="mt-8 h-44 w-full rounded-2xl" />
    </main>
  );
}
