import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function SubscriptionLoading() {
  return (
    <main className="mx-auto min-h-[60vh] w-full max-w-5xl px-4 py-8 sm:px-6" aria-busy aria-label="订阅页加载中">
      <SkeletonLine className="h-9 w-48" />
      <SkeletonLine className="mt-2 h-4 w-full max-w-md" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <SkeletonBlock className="h-36 rounded-2xl" />
        <SkeletonBlock className="h-36 rounded-2xl" />
      </div>
      <SkeletonBlock className="mt-6 h-52 w-full rounded-2xl" />
    </main>
  );
}
