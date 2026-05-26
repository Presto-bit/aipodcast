"use client";

import { Plus } from "../../icons";
import type { AuthorIpMaterial } from "../../../lib/authorIp";
import { cn } from "../../../lib/cn";
import AuthorIpMaterialCard from "./AuthorIpMaterialCard";
import MaterialStackBar from "./MaterialStackBar";
import type { MaterialSegment } from "./utils";

const SEGMENTS: { id: MaterialSegment; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "experience", label: "经历" },
  { id: "article", label: "成稿" }
];

type Props = {
  materials: AuthorIpMaterial[];
  segment: MaterialSegment;
  onSegment: (s: MaterialSegment) => void;
  counts: { experience: number; article: number; draft: number };
  readOnly: boolean;
  busy: boolean;
  onAddExperience: () => void;
  onAddArticle: () => void;
  onDelete: (noteId: string) => void;
};

export default function AuthorIpMaterialsColumn({
  materials,
  segment,
  onSegment,
  counts,
  readOnly,
  busy,
  onAddExperience,
  onAddArticle,
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
          <div className="flex gap-2">
            <button
              type="button"
              title="添加经历"
              aria-label="添加经历"
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-dawn-md border border-line bg-surface py-2 text-brand hover:bg-fill disabled:opacity-50"
              onClick={onAddExperience}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              title="添加成稿"
              aria-label="添加成稿"
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-dawn-md border border-line bg-surface py-2 text-brand hover:bg-fill disabled:opacity-50"
              onClick={onAddArticle}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
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
            {segment === "experience" ? "暂无经历" : segment === "article" ? "暂无成稿" : "暂无素材"}
            {!readOnly ? (
              <p className="mt-2">
                <button type="button" className="text-brand hover:underline" onClick={onAddExperience}>
                  添加经历
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
              onDelete={onDelete}
            />
          ))
        )}
      </ul>
    </div>
  );
}
