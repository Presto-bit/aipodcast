import { redirect } from "next/navigation";

export default function AdminUsageWorksPage() {
  redirect("/admin/usage?tab=works");
}
