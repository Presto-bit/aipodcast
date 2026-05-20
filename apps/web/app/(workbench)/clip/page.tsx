"use client";

import ClipAccessGate from "../../components/clip/ClipAccessGate";
import ClipHub from "../../components/clip/ClipHub";

export default function ClipPage() {
  return (
    <ClipAccessGate>
      <ClipHub />
    </ClipAccessGate>
  );
}
