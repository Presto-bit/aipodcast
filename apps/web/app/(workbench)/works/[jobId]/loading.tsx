import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function WorkDetailLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-5xl px-3 py-8 sm:px-4" aria-busy aria-label="作品详情加载中">
      <SkeletonLine className="h-8 w-64 max-w-[90%]" />
      <SkeletonLine className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-6 flex gap-2">
        <SkeletonBlock className="h-9 w-24 rounded-lg" />
        <SkeletonBlock className="h-9 w-24 rounded-lg" />
      </div>
      <SkeletonBlock className="mt-6 h-56 w-full rounded-2xl" />
      <SkeletonBlock className="mt-4 h-40 w-full rounded-2xl" />
    </main>
  );
}
