import { SkeletonBlock, SkeletonLine } from "../../../../components/ui/Skeleton";

export default function AdminUsersLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8" aria-busy aria-label="加载用户管理">
      <SkeletonLine className="h-8 w-40" />
      <SkeletonBlock className="h-64 w-full rounded-xl" />
    </div>
  );
}
