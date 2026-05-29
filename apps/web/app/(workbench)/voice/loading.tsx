import { SkeletonBlock, SkeletonLine } from "../../../components/ui/Skeleton";

export default function VoiceLoading() {
  return (
    <main className="mx-auto min-h-[50vh] w-full max-w-4xl px-4 py-8" aria-busy aria-label="音色管理加载中">
      <SkeletonLine className="h-8 w-36" />
      <SkeletonBlock className="mt-6 h-40 w-full rounded-xl" />
    </main>
  );
}
