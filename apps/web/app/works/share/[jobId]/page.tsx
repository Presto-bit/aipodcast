"use client";

import { useParams } from "next/navigation";
import { SharePublishClient } from "../../../../components/works/SharePublishClient";

export default function WorksSharePage() {
  const params = useParams();
  const jobId = String(params?.jobId || "").trim();
  if (!jobId) {
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 text-sm text-muted">
        无效的作品 ID
      </main>
    );
  }
  return <SharePublishClient jobId={jobId} />;
}
