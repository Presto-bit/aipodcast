import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function CreateLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-6xl px-3 py-8 sm:px-4" aria-busy aria-label="创作工作室加载中">
      <SkeletonLine className="mb-4 h-8 w-44" />
      <SkeletonLine className="mb-6 h-4 w-full max-w-lg" />
      <div className="mb-6 flex flex-wrap gap-2">
        <SkeletonBlock className="h-10 w-24 rounded-lg" />
        <SkeletonBlock className="h-10 w-24 rounded-lg" />
        <SkeletonBlock className="h-10 w-28 rounded-lg" />
      </div>
      <SkeletonBlock className="h-64 w-full rounded-2xl" />
      <SkeletonBlock className="mt-6 h-40 w-full rounded-2xl" />
    </main>
  );
}
