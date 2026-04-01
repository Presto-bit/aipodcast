"use client";

import { useParams } from "next/navigation";
import { JobDetailClient } from "../../../components/jobs/JobDetailClient";

export default function JobDetailPage() {
  const params = useParams();
  const jobId = String(params?.jobId || "").trim();
  return <JobDetailClient jobId={jobId} recordsListHref="/jobs" />;
}
