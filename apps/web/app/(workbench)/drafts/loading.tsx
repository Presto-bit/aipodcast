import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function DraftsLoading() {
  return (
    <main className="mx-auto min-h-[50vh] w-full max-w-4xl px-4 py-8" aria-busy aria-label="草稿加载中">
      <SkeletonLine className="h-8 w-32" />
      <SkeletonBlock className="mt-6 h-48 w-full rounded-xl" />
    </main>
  );
}
