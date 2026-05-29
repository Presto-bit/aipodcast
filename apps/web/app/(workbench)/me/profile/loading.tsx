import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function MeProfileLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8" aria-busy aria-label="加载个人资料">
      <SkeletonLine className="h-8 w-32" />
      <SkeletonBlock className="h-40 w-full rounded-xl" />
    </div>
  );
}
