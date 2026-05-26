"use client";

import { Plus } from "../../icons";
import type { AuthorIpMaterial } from "../../../lib/authorIp";
import { cn } from "../../../lib/cn";
import AuthorIpMaterialCard from "./AuthorIpMaterialCard";
import MaterialStackBar from "./MaterialStackBar";
import type { MaterialSegment } from "./utils";

const SEGMENTS: { id: MaterialSegment; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "experience", label: "简历" },
  { id: "article", label: "成稿" }
];

type Props = {
  materials: AuthorIpMaterial[];
  segment: MaterialSegment;
  onSegment: (s: MaterialSegment) => void;
  counts: { experience: number; article: number; draft: number };
  readOnly: boolean;
  busy: boolean;
  onAdd: () => void;
  onPreview: (material: AuthorIpMaterial) => void;
  onDelete: (noteId: string) => void;
};

export default function AuthorIpMaterialsColumn({
  materials,
  segment,
  onSegment,
  counts,
  readOnly,
  busy,
  onAdd,
  onPreview,
  onDelete
}: Props) {
  const activeBar = segment === "experience" ? "experience" : segment === "article" ? "article" : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl bg-fill/35">
      <div className="sticky top-0 z-10 space-y-3 rounded-t-2xl border-b border-line/60 bg-fill/90 p-3 backdrop-blur">
        <h2 className="text-sm font-semibold text-ink">素材</h2>
        <MaterialStackBar
          experience={counts.experience}
          article={counts.article}
          draft={counts.draft}
          active={activeBar}
          onSegmentClick={(s) => onSegment(s)}
        />
        {!readOnly ? (
          <button
            type="button"
            title="添加素材"
            aria-label="添加素材"
            disabled={busy}
            className="flex w-full items-center justify-center rounded-dawn-md border border-line bg-surface py-2.5 text-brand hover:bg-fill disabled:opacity-50"
            onClick={onAdd}
          >
            <Plus className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        <div className="flex rounded-lg bg-fill p-0.5" role="tablist" aria-label="素材筛选">
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={segment === s.id}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs transition",
                segment === s.id ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"
              )}
              onClick={() => onSegment(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pt-2">
        {materials.length === 0 ? (
          <li className="py-8 text-center text-xs text-muted">
            {segment === "experience" ? "暂无简历经历" : segment === "article" ? "暂无成稿" : "暂无素材"}
            {!readOnly ? (
              <p className="mt-2">
                <button type="button" className="text-brand hover:underline" onClick={onAdd}>
                  添加素材
                </button>
              </p>
            ) : null}
          </li>
        ) : (
          materials.map((m) => (
            <AuthorIpMaterialCard
              key={m.noteId}
              material={m}
              readOnly={readOnly}
              busy={busy}
              onPreview={onPreview}
              onDelete={onDelete}
            />
          ))
        )}
      </ul>
    </div>
  );
}
