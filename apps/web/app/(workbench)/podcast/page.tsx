import { redirect } from "next/navigation";

/** 深链兼容：统一进入创作页 code-split 入口 */
export default function PodcastRedirectPage() {
  redirect("/create?mode=podcast");
}
