"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import ClipAccessGate from "../../../../components/clip/ClipAccessGate";

const PrestoFlowEditor = dynamic(() => import("../../../../components/presto-flow/PrestoFlowEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">加载剪辑工作台…</div>
  )
});

export default function ClipProjectPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  if (!id) {
    return null;
  }
  return (
    <ClipAccessGate>
      <PrestoFlowEditor projectId={id} />
    </ClipAccessGate>
  );
}
