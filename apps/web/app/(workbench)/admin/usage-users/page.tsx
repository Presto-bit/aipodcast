import { redirect } from "next/navigation";

export default function AdminUsageUsersPage() {
  redirect("/admin/usage?tab=users");
}
