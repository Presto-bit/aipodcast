"use client";

import { useParams } from "next/navigation";
import ClipAccessGate from "../../../components/clip/ClipAccessGate";
import PrestoFlowEditor from "../../../components/presto-flow/PrestoFlowEditor";

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
