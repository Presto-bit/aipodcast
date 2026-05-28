"use client";

/** 参考资料区：风格提炼操作结果 Toast */
export default function NotebookStyleSourcesNotice({ actionToast }: { actionToast: string }) {
  if (!actionToast.trim()) return null;

  return (
    <p className="mt-2 text-[11px] font-medium text-brand" role="status">
      {actionToast}
    </p>
  );
}
