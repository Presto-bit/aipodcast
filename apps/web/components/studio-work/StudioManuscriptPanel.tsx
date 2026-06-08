"use client";

import type { BlockEvidence, ManuscriptBlock, ManuscriptVersion } from "../../lib/studioWorkTypes";
import { manuscriptCopyAll } from "../../lib/studioDeliverable";
import { XHS_SHIP_STEPS } from "../../lib/studioWorkTypes";

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
    <div className={`rounded-xl border bg-surface p-3 ${border}`}>
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
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {block.kind === "title"
              ? "标题"
              : block.kind === "body"
                ? "正文"
                : block.kind === "hashtags"
                  ? "话题"
                  : block.kind === "interaction"
                    ? "互动"
                    : "封面说明"}
          </span>
          {block.kind === "title" || block.kind === "body" ? (
            <EvidenceTag evidence={block.evidence} />
          ) : null}
        </div>
        <button type="button" className="text-[11px] text-brand hover:underline" onClick={onCopy}>
          复制
        </button>
      </div>
      {block.kind === "title" || block.kind === "body" || block.kind === "interaction" ? (
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-[1.72] text-ink">{block.text}</p>
      ) : null}
      {block.kind === "hashtags" ? (
        <p className="mt-2 text-sm text-ink">
          {block.tags.map((t) => (
            <span key={t} className="mr-2 text-brand">
              #{t.replace(/^#/, "")}
            </span>
          ))}
        </p>
      ) : null}
      {block.kind === "coverBrief" ? (
        <>
          <p className="mt-2 text-sm text-ink">{block.text}</p>
          <div className="mt-2 rounded-lg border border-dashed border-line bg-fill/30 px-3 py-6 text-center text-xs text-muted">
            假预览区 · 发布前在相册制作配图
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function StudioManuscriptPanel({
  tab,
  onTabChange,
  version,
  compareBlocks,
  compareMode,
  selectedKeys,
  changedKeys,
  onToggleKey,
  shipChecks,
  onShipCheck,
  readOnly
}: {
  tab: "manuscript" | "ship";
  onTabChange: (t: "manuscript" | "ship") => void;
  version: ManuscriptVersion | null;
  compareBlocks?: ManuscriptBlock[] | null;
  compareMode?: boolean;
  selectedKeys?: Set<string>;
  changedKeys?: Set<string>;
  onToggleKey?: (key: string) => void;
  shipChecks: Record<string, boolean>;
  onShipCheck: (id: string, v: boolean) => void;
  readOnly?: boolean;
}) {
  const blocks = compareMode && compareBlocks ? compareBlocks : version?.blocks ?? [];

  function copyBlock(b: ManuscriptBlock) {
    if (b.kind === "hashtags") {
      void navigator.clipboard.writeText(b.tags.map((t) => `#${t}`).join(" "));
    } else if (b.kind === "title" || b.kind === "body" || b.kind === "coverBrief") {
      void navigator.clipboard.writeText(b.text);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 border-b border-line pb-2">
        <button
          type="button"
          className={[
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            tab === "manuscript" ? "bg-brand/10 text-brand" : "text-muted hover:text-ink"
          ].join(" ")}
          onClick={() => onTabChange("manuscript")}
        >
          稿件
        </button>
        <button
          type="button"
          className={[
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            tab === "ship" ? "bg-brand/10 text-brand" : "text-muted hover:text-ink"
          ].join(" ")}
          onClick={() => onTabChange("ship")}
        >
          发布包
        </button>
        {version && tab === "manuscript" ? (
          <span className="ml-auto self-center text-xs text-muted">{version.label}</span>
        ) : null}
      </div>

      {tab === "ship" ? (
        <ul className="mt-3 space-y-2 overflow-y-auto pb-4">
          {XHS_SHIP_STEPS.map((step) => (
            <li key={step.id} className="rounded-lg border border-line bg-fill/20 px-3 py-2.5">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(shipChecks[step.id])}
                  onChange={(e) => onShipCheck(step.id, e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium text-ink">
                    {step.id}. {step.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{step.copyHint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted">确认生成后，稿件块将显示在这里。</p>
          ) : (
            blocks.map((b) => {
              const key = b.kind === "title" ? `${b.kind}:${b.id}` : b.kind;
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
            })
          )}
          {version && !compareMode && !readOnly ? (
            <button
              type="button"
              className="w-full rounded-lg border border-line py-2 text-sm text-ink hover:bg-fill"
              onClick={() => void navigator.clipboard.writeText(manuscriptCopyAll(version.blocks))}
            >
              复制全部（含话题）
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
