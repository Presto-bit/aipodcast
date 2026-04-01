import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function JobDetailLoading() {
  return (
    <main className="min-h-0 max-w-4xl space-y-4">
      <SkeletonLine className="h-8 w-56" />
      <SkeletonLine className="h-4 w-32" />
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonBlock className="h-32 w-full" />
    </main>
  );
}
