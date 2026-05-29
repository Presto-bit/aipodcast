"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const JobDetailClient = dynamic(
  () => import("../../../../components/jobs/JobDetailClient").then((m) => ({ default: m.JobDetailClient })),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-3xl px-3 py-10 text-sm text-muted" aria-busy>
        加载任务详情…
      </div>
    )
  }
);

export default function JobDetailPage() {
  const params = useParams();
  const jobId = String(params?.jobId || "").trim();
  return <JobDetailClient jobId={jobId} recordsListHref="/jobs" />;
}
