"use client";

import { cn } from "../../../lib/cn";

type Props = {
  experience: number;
  article: number;
  draft: number;
  active?: "all" | "experience" | "article";
  onSegmentClick?: (segment: "experience" | "article") => void;
};

export default function MaterialStackBar({ experience, article, draft, active, onSegmentClick }: Props) {
  const total = Math.max(1, experience + article + draft);
  const expW = (experience / total) * 100;
  const artW = (article / total) * 100;
  const drfW = (draft / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-line/40" role="img" aria-label={`经历 ${experience}，成稿 ${article}，草稿 ${draft}`}>
        {experience > 0 ? (
          <button
            type="button"
            title={`经历 ${experience}`}
            className={cn("h-full bg-teal-600 transition-opacity", active === "experience" ? "opacity-100" : "opacity-85 hover:opacity-100")}
            style={{ width: `${expW}%` }}
            onClick={() => onSegmentClick?.("experience")}
          />
        ) : null}
        {article > 0 ? (
          <button
            type="button"
            title={`成稿 ${article}`}
            className={cn("h-full bg-amber-600 transition-opacity", active === "article" ? "opacity-100" : "opacity-85 hover:opacity-100")}
            style={{ width: `${artW}%` }}
            onClick={() => onSegmentClick?.("article")}
          />
        ) : null}
        {draft > 0 ? (
          <span className="h-full bg-slate-400" style={{ width: `${drfW}%` }} title={`草稿 ${draft}`} />
        ) : null}
      </div>
      <div className="flex gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-teal-600" aria-hidden />
          经历
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-amber-600" aria-hidden />
          成稿
        </span>
      </div>
    </div>
  );
}
