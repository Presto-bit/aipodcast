import { redirect } from "next/navigation";

/** 本地文稿已下线：/drafts → 作品 */
export default function DraftsRedirectPage() {
  redirect("/works");
}
