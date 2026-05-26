"use client";

import { Button } from "../../ui/Button";
import type { AuthorIpMaterial } from "../../../lib/authorIp";
import AuthorIpCompactModal from "./AuthorIpCompactModal";
import { tryParseResume, resumeToMarkdown } from "./resumeTypes";

type Props = {
  open: boolean;
  material: AuthorIpMaterial | null;
  readOnly?: boolean;
  onClose: () => void;
  onEditResume?: () => void;
  onLearningToggle?: (includeInStyleLearning: boolean) => void;
};

export default function AuthorIpMaterialPreviewModal({
  open,
  material,
  readOnly,
  onClose,
  onEditResume,
  onLearningToggle
}: Props) {
  if (!material) return null;

  const resume = material.materialType === "experience_card" ? tryParseResume(material.body || "") : null;
  const displayBody = resume ? resumeToMarkdown(resume) : (material.body || material.preview || "").trim();
  const isExperience = Boolean(resume);

  return (
    <AuthorIpCompactModal
      open={open}
      title={material.title}
      description={
        (isExperience ? "经历" : material.materialType === "draft" ? "草稿" : "成稿资料") +
        (material.bodyLength ? ` · ${material.bodyLength} 字` : "")
      }
      onClose={onClose}
      maxWidthClass="max-w-lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {onLearningToggle && !readOnly ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={material.includeInStyleLearning !== false}
                onChange={(e) => onLearningToggle(e.target.checked)}
              />
              参与文风学习
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {isExperience && onEditResume ? (
              <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onEditResume}>
                编辑经历
              </Button>
            ) : null}
            <Button type="button" className="px-2.5 py-1.5 text-xs" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      }
    >
      <pre className="max-h-[min(50vh,400px)] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90">
        {displayBody || "（无正文）"}
      </pre>
    </AuthorIpCompactModal>
  );
}
