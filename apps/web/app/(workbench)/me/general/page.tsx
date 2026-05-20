import { redirect } from "next/navigation";

/** RSS 发布设置已并入「作品详情 → 分享与发布」；保留路径以兼容书签。 */
export default function MeGeneralRedirectPage() {
  redirect("/me/profile");
}
