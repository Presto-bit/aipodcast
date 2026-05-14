"use client";

import ShownotesStudio from "./ShownotesStudio";

export type ShownotesMakeClientProps = {
  projectId: string;
  embedOnLanding?: boolean;
  /** 已废弃：新工作台始终展示完整 UI */
  deferNotesUiUntilTranscribeOk?: boolean;
  fileLabel?: string;
  onRequestNewUpload?: () => void;
};

/** @deprecated 请优先使用 ShownotesStudio；本组件仅为兼容旧 import。 */
export default function ShownotesMakeClient({
  projectId,
  embedOnLanding,
  fileLabel,
  onRequestNewUpload
}: ShownotesMakeClientProps) {
  return (
    <ShownotesStudio
      projectId={projectId}
      embedOnLanding={embedOnLanding}
      fileLabel={fileLabel}
      onRequestNewUpload={onRequestNewUpload}
    />
  );
}
