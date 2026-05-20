import { redirect } from "next/navigation";

/** 旧「设置」入口已并入个人资料；保留路径以兼容书签与外链 */
export default function SettingsRedirectPage() {
  redirect("/me/profile");
}
