"use client";

import dynamic from "next/dynamic";
import ClipAccessGate from "../../../components/clip/ClipAccessGate";

const ClipHub = dynamic(() => import("../../../components/clip/ClipHub"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-4xl px-3 py-10 text-sm text-muted" aria-busy>
      加载剪辑项目…
    </div>
  )
});

export default function ClipPage() {
  return (
    <ClipAccessGate>
      <ClipHub />
    </ClipAccessGate>
  );
}
