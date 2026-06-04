"use client";

import type { BlockEvidence, ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";

function blockKey(b: ManuscriptBlock): string {
  return b.kind === "title" ? `${b.kind}:${b.id}` : b.kind;
}

function EvidenceTag({ evidence }: { evidence?: BlockEvidence }) {
  if (!evidence) return null;
  const label =
    evidence === "corpus" ? "资料" : evidence === "verify" ? "待核实" : "补充";
  const cls =
    evidence === "corpus"
      ? "text-brand"
      : evidence === "verify"
        ? "text-warning-ink"
        : "text-muted";
  return <span className={`text-[10px] font-medium ${cls}`}>{label}</span>;
}

function BlockCard({
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
  const border = changed ? "border-brand/50 ring-1 ring-brand/20" : "border-line";

  return (
    <div className={`rounded-lg border bg-surface px-2.5 py-2 ${border}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {compareMode && changed && onToggle ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="rounded border-line"
            />
          ) : null}
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {block.kind === "title"
              ? "标题"
              : block.kind === "body"
                ? "正文"
                : block.kind === "hashtags"
                  ? "话题"
                  : "封面说明"}
          </span>
          {block.kind !== "hashtags" && block.kind !== "coverBrief" ? (
            <EvidenceTag evidence={block.evidence} />
          ) : null}
        </div>
        <button type="button" className="text-[10px] text-brand hover:underline" onClick={onCopy}>
          复制
        </button>
      </div>
      {block.kind === "title" || block.kind === "body" ? (
        <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{block.text}</p>
      ) : null}
      {block.kind === "hashtags" ? (
        <p className="mt-1.5 text-sm text-ink">
          {block.tags.map((t) => (
            <span key={t} className="mr-2 text-brand">
              #{t.replace(/^#/, "")}
            </span>
          ))}
        </p>
      ) : null}
      {block.kind === "coverBrief" ? (
        <p className="mt-1.5 text-sm text-ink">{block.text}</p>
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

/** 输出区内的稿件块列表 */
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
          <BlockCard
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
        <button
          type="button"
          className="w-full rounded-md border border-line py-1.5 text-xs text-ink hover:bg-fill"
          onClick={() => void navigator.clipboard.writeText(manuscriptCopyAll(version.blocks))}
        >
          复制全部（含话题）
        </button>
      ) : null}
    </div>
  );
}
