/** 打开他人公开分享的笔记本（与 Notes Hub 热门列表一致）。 */
export function buildSharedNotebookWorkbenchHref(
  notebook: string,
  ownerUserId: string,
  access: "read_only" | "edit"
): string {
  const q = new URLSearchParams({
    sharedFromOwnerUserId: ownerUserId,
    shareAccess: access
  });
  return `/notes/${encodeURIComponent(notebook)}?${q.toString()}`;
}
