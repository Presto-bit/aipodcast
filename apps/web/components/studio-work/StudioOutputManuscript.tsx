"use client";

import type { BlockEvidence, ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";

function blockKey(b: ManuscriptBlock): string {
  return b.kind === "title" ? `${b.kind}:${b.id}` : b.kind;
}

function IconCopy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyIconButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-muted hover:bg-fill/80 hover:text-ink"
    >
      <IconCopy />
    </button>
  );
}

function EvidenceTag({ evidence }: { evidence?: BlockEvidence }) {
  if (!evidence || evidence === "model") return null;
  const label = evidence === "corpus" ? "资料" : "待核实";
  const cls = evidence === "corpus" ? "text-brand" : "text-warning-ink";
  return <span className={`text-[10px] font-medium ${cls}`}>{label}</span>;
}

function kindLabel(kind: ManuscriptBlock["kind"]): string {
  switch (kind) {
    case "title":
      return "标题";
    case "body":
      return "正文";
    case "hashtags":
      return "话题";
    default:
      return "封面说明";
  }
}

function blockSurface(kind: ManuscriptBlock["kind"], changed: boolean): string {
  const base =
    kind === "title"
      ? "bg-brand/6"
      : kind === "body"
        ? "bg-fill/50"
        : "bg-surface";
  const border = changed ? "border-brand/45" : "border-line/50";
  return `rounded-md border px-2.5 py-2 ${base} ${border}`;
}

function BlockRow({
  block,
  compareMode,
  selected,
  changed,
  onToggle,
  onCopy
}: {
  block: ManuscriptBlock;
  compareMode?: boolean;
  selected?: boolean;
  changed?: boolean;
  onToggle?: () => void;
  onCopy: () => void;
}) {
  return (
    <div className={blockSurface(block.kind, Boolean(changed))}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {compareMode && changed && onToggle ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="rounded border-line"
            />
          ) : null}
          <span className="text-[10px] font-medium text-muted">{kindLabel(block.kind)}</span>
          {block.kind !== "hashtags" && block.kind !== "coverBrief" ? (
            <EvidenceTag evidence={block.evidence} />
          ) : null}
        </div>
        <CopyIconButton title={`复制${kindLabel(block.kind)}`} onClick={onCopy} />
      </div>
      {block.kind === "title" || block.kind === "body" ? (
        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{block.text}</p>
      ) : null}
      {block.kind === "hashtags" ? (
        <p className="mt-1 text-sm text-ink">
          {block.tags.map((t) => (
            <span key={t} className="mr-2 text-brand">
              #{t.replace(/^#/, "")}
            </span>
          ))}
        </p>
      ) : null}
      {block.kind === "coverBrief" ? (
        <p className="mt-1 text-sm text-ink">{block.text}</p>
      ) : null}
    </div>
  );
}

function copyBlock(b: ManuscriptBlock) {
  if (b.kind === "hashtags") {
    void navigator.clipboard.writeText(b.tags.map((t) => `#${t}`).join(" "));
  } else if (b.kind === "title" || b.kind === "body" || b.kind === "coverBrief") {
    void navigator.clipboard.writeText(b.text);
  }
}

/** 输出区内的稿件（扁平文本 + 色块，复制为图标） */
export default function StudioOutputManuscript({
  version,
  compareBlocks,
  compareMode,
  selectedKeys,
  changedKeys,
  onToggleKey
}: {
  version: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[] | null;
  compareMode?: boolean;
  selectedKeys?: Set<string>;
  changedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
}) {
  const blocks = compareMode && compareBlocks ? compareBlocks : version?.blocks ?? [];
  if (!blocks.length) return null;

  return (
    <div className="space-y-2">
      {blocks.map((b) => {
        const key = blockKey(b);
        return (
          <BlockRow
            key={key}
            block={b}
            compareMode={compareMode}
            changed={changedKeys?.has(key)}
            selected={selectedKeys?.has(key)}
            onToggle={onToggleKey ? () => onToggleKey(key) : undefined}
            onCopy={() => copyBlock(b)}
          />
        );
      })}
      {version && !compareMode ? (
        <div className="flex justify-end pt-0.5">
          <CopyIconButton
            title="复制全部（含话题）"
            onClick={() => void navigator.clipboard.writeText(manuscriptCopyAll(version.blocks))}
          />
        </div>
      ) : null}
    </div>
  );
}
