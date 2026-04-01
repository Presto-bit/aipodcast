import { redirect } from "next/navigation";

export default function AdminUsageAlertsPage() {
  redirect("/admin/usage?tab=alerts");
}
