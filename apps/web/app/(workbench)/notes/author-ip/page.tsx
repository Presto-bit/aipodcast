import { redirect } from "next/navigation";

/** v6：个人风格 IP 已迁入笔记本，旧列表页重定向至知识库 */
export default function AuthorIpListRedirectPage() {
  redirect("/notes");
}
