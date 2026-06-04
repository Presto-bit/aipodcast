import { redirect } from "next/navigation";

type Props = {
  searchParams?: Promise<{ section?: string }> | { section?: string };
};

/** @deprecated 使用 /works/trash；保留重定向以兼容旧链接。 */
export default async function NotesTrashRedirectPage({ searchParams }: Props) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams;
  const section = String(sp?.section || "").trim().toLowerCase();
  if (section === "notes") {
    redirect("/works/trash?section=notes");
  }
  redirect("/works/trash");
}
