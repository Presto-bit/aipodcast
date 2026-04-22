"use client";

import { useParams, useSearchParams } from "next/navigation";
import { SharePublishClient } from "../../../components/works/SharePublishClient";

export default function WorkDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const jobId = String(params?.jobId || "").trim();
  const tab = String(searchParams?.get("tab") || "")
    .trim()
    .toLowerCase();
  const initialHubTab = tab === "publish" ? ("publish" as const) : ("overview" as const);

  if (!jobId) {
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 text-sm text-muted">无效的作品 ID</main>
    );
  }

  return (
    <SharePublishClient key={jobId} jobId={jobId} layout="work_hub" initialHubTab={initialHubTab} />
  );
}
