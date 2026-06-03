"use client";

import { useMemo, useState } from "react";
import type { AssistantBlock, PlatformExpertId } from "../../../lib/homeComposerExpertTypes";
import { EXPERT_DISPLAY_NAMES } from "../../../lib/composerExperts";
import {
  deliverableBodyText,
  deliverablePreviewText,
  deliverableTitleText,
  isXhsContent
} from "../../../lib/homeComposerExpertJob";
import DeliverablePreviewFrame from "./DeliverablePreviewFrame";
import OpsPlaybookPanel from "./OpsPlaybookPanel";
import DeliverableFeedbackInline from "./DeliverableFeedbackInline";
import DeliverableConsiderationPanel from "./DeliverableConsiderationPanel";
import { trackComposerExpertEvent } from "../../../lib/composerExpertAnalytics";

type DeliverableBlock = Extract<AssistantBlock, { kind: "deliverable" }>;
type FeedbackBlock = Extract<AssistantBlock, { kind: "feedback" }>;
type TabId = "product" | "ops" | "provenance";

const COVERAGE_LABELS = {
  full: "资料覆盖完整",
  partial: "资料部分覆盖",
  none: "基于任务描述生成"
} as const;

async function copyText(
  text: string,
  onCopyToast?: (msg: string) => void,
  okMsg = "已复制",
  track?: { expertId: PlatformExpertId; target: string }
) {
  try {
    await navigator.clipboard.writeText(text);
    onCopyToast?.(okMsg);
    if (track) {
      trackComposerExpertEvent("copy", { expertId: track.expertId, target: track.target });
    }
  } catch {
    onCopyToast?.("复制失败");
  }
}

function ProvenancePanel({ block }: { block: DeliverableBlock }) {
  const { meta } = block;
  const prov = meta.provenance;

  return (
    <div className="space-y-4 text-sm">
      {meta.featureUsage?.applied ? (
        <section className="rounded-xl border border-line/80 bg-fill/20 p-3">
          <p className="font-medium text-ink">🙋 特色运用</p>
          <p className="mt-1 text-ink">{meta.featureUsage.summaryLine}</p>
          {meta.featureUsage.items?.length ? (
            <ul className="mt-2 list-inside list-disc text-muted">
              {meta.featureUsage.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-line/80 bg-fill/20 p-3">
        <p className="font-medium text-ink">📎 依据</p>
        <p className="mt-1 text-muted">{COVERAGE_LABELS[prov.corpusCoverage]}</p>
        {prov.materialLabels?.length ? (
          <p className="mt-1 text-muted">资料：{prov.materialLabels.join("、")}</p>
        ) : null}
        {prov.corpusSegments?.length ? (
          <ul className="mt-2 list-inside list-disc text-xs text-muted">
            {prov.corpusSegments.slice(0, 5).map((seg) => (
              <li key={seg}>{seg}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {meta.rationale.length ? (
        <section>
          <p className="font-medium text-ink">为什么这样做</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
            {meta.rationale.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {meta.expectedEffect ? (
        <section>
          <p className="font-medium text-ink">预期效果</p>
          <p className="mt-1 text-muted">{meta.expectedEffect}</p>
        </section>
      ) : null}
    </div>
  );
}

function XhsProductPanel({
  block,
  titleIndex,
  onTitleIndexChange,
  onCopyToast,
  feedbackBlock,
  feedbackDisabled,
  onFeedbackPatch
}: {
  block: DeliverableBlock;
  titleIndex: number;
  onTitleIndexChange: (idx: number) => void;
  onCopyToast?: (msg: string) => void;
  feedbackBlock?: FeedbackBlock;
  feedbackDisabled?: boolean;
  onFeedbackPatch?: (patch: Partial<FeedbackBlock>) => void;
}) {
  if (!isXhsContent(block.content)) return null;
  const content = block.content;
  const deliverable = {
    expertId: block.expertId,
    content: block.content,
    ops: block.ops,
    meta: block.meta
  };
  const titles = content.titles.slice(0, 3);

  return (
    <div className="space-y-4">
      <DeliverableConsiderationPanel meta={block.meta} />

      <div>
        <p className="text-xs font-medium text-muted">标题备选</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {titles.map((title, idx) => (
            <button
              key={title}
              type="button"
              className={[
                "rounded-lg border px-2.5 py-1 text-xs transition",
                titleIndex === idx
                  ? "border-brand bg-brand/10 text-ink"
                  : "border-line text-muted hover:border-brand/40"
              ].join(" ")}
              onClick={() => onTitleIndexChange(idx)}
            >
              {idx + 1}
            </button>
          ))}
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium text-ink">
          {titles[titleIndex] || titles[0] || "（无标题）"}
        </p>
      </div>

      <div className="rounded-xl border border-line/80 bg-fill/20 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{content.body}</p>
        {content.hashtags.length ? (
          <p className="mt-3 text-xs text-muted">
            {content.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill"
            onClick={() =>
              void copyText(deliverableTitleText(deliverable, titleIndex), onCopyToast, "已复制标题", {
                expertId: block.expertId,
                target: "title"
              })
            }
          >
            复制标题
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill"
            onClick={() =>
              void copyText(deliverableBodyText(deliverable), onCopyToast, "已复制正文", {
                expertId: block.expertId,
                target: "body"
              })
            }
          >
            复制正文
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand/90"
            onClick={() =>
              void copyText(deliverablePreviewText(deliverable), onCopyToast, "已复制全文含 tag", {
                expertId: block.expertId,
                target: "full"
              })
            }
          >
            复制全文含 tag
          </button>
        </div>
        {feedbackBlock && onFeedbackPatch ? (
          <DeliverableFeedbackInline
            block={feedbackBlock}
            disabled={feedbackDisabled}
            onPatch={onFeedbackPatch}
            onNotify={() => undefined}
          />
        ) : null}
      </div>

      {content.cover.slides.length ? (
        <details className="rounded-lg border border-line/60 bg-fill/10 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted">内页图说明（{content.cover.slides.length} 张）</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {content.cover.slides.map((slide) => (
              <li key={`${slide.role}-${slide.description}`}>
                {slide.role === "cover" ? "封面" : "内页"} · {slide.description}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <DeliverablePreviewFrame content={content} />
    </div>
  );
}

export default function DeliverableCard({
  block,
  expertId,
  featureCoreComplete = 0,
  onCopyToast,
  feedbackBlock,
  feedbackDisabled,
  onFeedbackPatch
}: {
  block: DeliverableBlock;
  expertId: PlatformExpertId;
  featureCoreComplete?: number;
  onCopyToast?: (msg: string) => void;
  feedbackBlock?: FeedbackBlock;
  feedbackDisabled?: boolean;
  onFeedbackPatch?: (patch: Partial<FeedbackBlock>) => void;
}) {
  const [tab, setTab] = useState<TabId>("product");
  const [titleIndex, setTitleIndex] = useState(0);

  const deliverable = useMemo(
    () => ({
      expertId: block.expertId,
      content: block.content,
      ops: block.ops,
      meta: block.meta
    }),
    [block]
  );

  const mustDoCount = block.ops.steps.filter((s) => s.tier === "must_do").length;
  const showFeatureBadge = featureCoreComplete >= 3;

  return (
    <div className="w-full min-w-0 rounded-2xl border-2 border-brand/25 bg-surface shadow-soft">
      <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">{EXPERT_DISPLAY_NAMES[expertId]} · 刚刚</p>
          <p className="mt-0.5 text-[11px] text-muted">{block.meta.playbookVersion}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
          onClick={() =>
            void copyText(deliverablePreviewText(deliverable), onCopyToast, "已复制全部", {
              expertId,
              target: "all"
            })
          }
        >
          复制全部
        </button>
      </div>

      <div className="flex gap-1 border-b border-line/60 px-3 pt-2">
        {(
          [
            { id: "product" as const, label: "成品", badge: showFeatureBadge ? "已用你的特色" : undefined },
            { id: "ops" as const, label: "发布清单", badge: mustDoCount ? `${mustDoCount} 步必做` : undefined },
            { id: "provenance" as const, label: "依据", badge: undefined }
          ]
        ).map(({ id, label, badge }) => (
          <button
            key={id}
            type="button"
            className={[
              "relative mb-[-1px] rounded-t-lg px-3 py-2 text-xs font-medium transition",
              tab === id
                ? "border border-b-surface border-line/80 bg-surface text-ink"
                : "text-muted hover:text-ink"
            ].join(" ")}
            onClick={() => {
              setTab(id);
              trackComposerExpertEvent("tab", { expertId, tab: id });
            }}
          >
            {label}
            {badge && tab === id ? (
              <span className="ml-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">{badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "product" ? (
          expertId === "xhs_ops" && isXhsContent(block.content) ? (
            <XhsProductPanel
              block={block}
              titleIndex={titleIndex}
              onTitleIndexChange={setTitleIndex}
              onCopyToast={onCopyToast}
              feedbackBlock={feedbackBlock}
              feedbackDisabled={feedbackDisabled}
              onFeedbackPatch={onFeedbackPatch}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">该专家成品预览将在后续版本接入；可先复制 JSON 或切换「发布清单」。</p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-fill/30 p-3 text-xs text-ink">
                {JSON.stringify(block.content, null, 2)}
              </pre>
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                onClick={() =>
                  void copyText(deliverablePreviewText(deliverable), onCopyToast, "已复制", {
                    expertId: block.expertId,
                    target: "json"
                  })
                }
              >
                复制内容
              </button>
            </div>
          )
        ) : null}
        {tab === "ops" ? <OpsPlaybookPanel ops={block.ops} onCopyToast={onCopyToast} /> : null}
        {tab === "provenance" ? <ProvenancePanel block={block} /> : null}
      </div>
    </div>
  );
}
