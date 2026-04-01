import { SkeletonBlock, SkeletonLine } from "../../components/ui/Skeleton";

export default function JobsLoading() {
  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <SkeletonLine className="mb-6 h-7 w-48" />
      <SkeletonLine className="mb-4 h-4 w-full max-w-lg" />
      <SkeletonBlock className="h-12 w-full max-w-md" />
      <SkeletonBlock className="mt-6 h-64 w-full" />
    </main>
  );
}
