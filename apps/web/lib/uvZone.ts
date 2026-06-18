import {
  isMarketingShellLessPath,
  matchesAdminConsole,
  matchesNotesWorkbench,
  matchesProductStudio,
  matchesWorkbenchTools,
  normalizePathname
} from "./navPaths";

export type UvZone = "marketing" | "workbench" | "other";

/** 管理端 UV 分区；`/admin` 返回 null 表示不应上报。 */
export function classifyUvZone(pathname: string): UvZone | null {
  const n = normalizePathname(pathname || "/");
  if (matchesAdminConsole(n)) return null;
  if (isMarketingShellLessPath(n)) return "marketing";
  if (n === "/login" || n === "/register") return "marketing";
  if (n === "/subscription" || n.startsWith("/subscription/")) return "marketing";
  if (n === "/help" || n.startsWith("/legal/")) return "marketing";
  if (
    matchesProductStudio(n) ||
    matchesWorkbenchTools(n) ||
    matchesNotesWorkbench(n) ||
    n === "/works" ||
    n.startsWith("/works/") ||
    n === "/drafts" ||
    n.startsWith("/drafts/") ||
    n === "/me" ||
    n.startsWith("/me/") ||
    n === "/settings" ||
    n.startsWith("/settings/")
  ) {
    return "workbench";
  }
  return "other";
}
