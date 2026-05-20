import { redirect } from "next/navigation";

/** 旧「概览」入口已并入总览看板，保留路径以免书签失效 */
export default function AdminHubRedirectPage() {
  redirect("/admin/usage");
}
