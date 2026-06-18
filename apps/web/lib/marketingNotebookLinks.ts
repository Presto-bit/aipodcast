import { buildSharedNotebookWorkbenchHref } from "./sharedNotebookNav";

/** 营销页「体验笔记本」默认打开热门发现中的笔记本名称。 */
export const MARKETING_POPULAR_FINANCE_NOTEBOOK_NAME = "财经笔记本";

/**
 * 跳转热门笔记本中的财经示例：
 * - 配置了 owner UUID 时直达分享页
 * - 否则进入 /notes 热门 Tab 并按名称自动打开
 */
export function marketingFinanceNotebookHref(): string {
  const owner = process.env.NEXT_PUBLIC_MARKETING_FINANCE_NOTEBOOK_OWNER_USER_ID?.trim();
  const name =
    process.env.NEXT_PUBLIC_MARKETING_FINANCE_NOTEBOOK_NAME?.trim() || MARKETING_POPULAR_FINANCE_NOTEBOOK_NAME;
  if (owner) {
    return buildSharedNotebookWorkbenchHref(name, owner, "read_only");
  }
  const q = new URLSearchParams({ discover: "popular", openNotebook: name });
  return `/notes?${q.toString()}`;
}
