import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function ClipProjectLoading() {
  return (
    <main className="flex min-h-[60vh] w-full flex-col px-2 py-4 sm:px-3" aria-busy aria-label="剪辑工作台加载中">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonBlock className="mt-4 min-h-[50vh] w-full rounded-xl" />
    </main>
  );
}
