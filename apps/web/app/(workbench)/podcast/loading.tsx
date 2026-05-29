import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function PodcastRedirectLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-8" aria-busy aria-label="跳转创作页">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonBlock className="h-48 w-full rounded-xl" />
    </div>
  );
}
