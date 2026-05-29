import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";

/** 工作台路由切换时的统一骨架屏（与 route loading.tsx 视觉一致）。 */
export default function WorkbenchRouteFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 lg:px-8" aria-busy aria-label="页面加载中">
      <SkeletonLine className="h-8 w-48 max-w-[80%]" />
      <SkeletonLine className="h-4 w-full max-w-xl" />
      <SkeletonBlock className="h-52 w-full max-w-3xl rounded-xl" />
      <SkeletonBlock className="h-36 w-full max-w-3xl rounded-xl" />
    </div>
  );
}
