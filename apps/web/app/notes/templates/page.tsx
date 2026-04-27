import { redirect } from "next/navigation";

/** 旧「风格模板」入口已并入音色管理「人设风格」标签 */
export default function NotesTemplatesLegacyRedirect() {
  redirect("/voice?tab=persona");
}
