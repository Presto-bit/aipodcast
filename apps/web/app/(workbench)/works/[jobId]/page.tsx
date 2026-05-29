"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";

const SharePublishClient = dynamic(
  () => import("../../../../components/works/SharePublishClient").then((m) => ({ default: m.SharePublishClient })),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-3xl px-3 py-10 text-sm text-muted" aria-busy>
        加载作品详情…
      </div>
    )
  }
);

export default function WorkDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const jobId = String(params?.jobId || "").trim();
  const tab = String(searchParams?.get("tab") || "")
    .trim()
    .toLowerCase();
  const initialHubTab = tab === "publish" ? ("publish" as const) : ("overview" as const);
  const returnTo = searchParams?.get("returnTo")?.trim() || null;

  if (!jobId) {
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 text-sm text-muted">无效的作品 ID</main>
    );
  }

  return (
    <SharePublishClient
      key={jobId}
      jobId={jobId}
      layout="work_hub"
      initialHubTab={initialHubTab}
      returnTo={returnTo}
    />
  );
}
