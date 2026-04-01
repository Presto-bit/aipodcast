import { redirect } from "next/navigation";

/** 旧「设置」入口已并入「我的 → 通用设置」，保留路径以兼容书签与外链 */
export default function SettingsRedirectPage() {
  redirect("/me/general");
}
