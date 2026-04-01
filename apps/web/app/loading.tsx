import { SkeletonBlock, SkeletonLine } from "../components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonLine className="h-4 w-full max-w-md" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
