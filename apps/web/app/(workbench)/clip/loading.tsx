import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function ClipHubLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-3 py-10" aria-busy aria-label="加载剪辑">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonBlock className="h-36 w-full rounded-xl" />
    </div>
  );
}
