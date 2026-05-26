"use client";

import { useCallback, useState } from "react";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem, AuthorIpLearnMode, AuthorIpTrait } from "../../../lib/authorIp";
import AuthorIpDistillDomains from "./AuthorIpDistillDomains";
import AuthorIpDistillResolver from "./AuthorIpDistillResolver";
import AuthorIpDistillTraits from "./AuthorIpDistillTraits";
import AuthorIpDistillVitality from "./AuthorIpDistillVitality";
import MaturityTriangleChart from "./MaturityTriangleChart";
import {
  domainsFromItem,
  maturityDistillHint,
  tagCloudFromItem,
  traitsFromItem,
  triangleState
} from "./utils";

type Props = {
  ipId: string;
  item: AuthorIpItem;
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onLearn: (mode: AuthorIpLearnMode) => void;
  onTraitsChange: (traits: AuthorIpTrait[]) => Promise<void>;
};

export default function AuthorIpDistillPanel({
  ipId,
  item,
  counts,
  readOnly,
  busy,
  highlightTags,
  onLearn,
  onTraitsChange
}: Props) {
  const [hintOpen, setHintOpen] = useState(false);
  const [traitsLocal, setTraitsLocal] = useState<AuthorIpTrait[] | null>(null);

  const tri = triangleState(item, counts);
  const traits = traitsLocal ?? traitsFromItem(item);
  const tags = tagCloudFromItem(item);
  const domains = domainsFromItem(item);
  const hint = maturityDistillHint(item, counts);

  const syncTraits = useCallback(
    async (next: AuthorIpTrait[]) => {
      setTraitsLocal(next);
      await onTraitsChange(next);
      setTraitsLocal(null);
    },
    [onTraitsChange]
  );

  const onToggle = (index: number, on: boolean) => {
    const next = traits.map((t, i) => (i === index ? { ...t, defaultOn: on } : t));
    void syncTraits(next);
  };

  const onRemove = (index: number) => {
    const next = traits.filter((_, i) => i !== index);
    void syncTraits(next);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-br-2xl bg-gradient-to-br from-brand/[0.06] via-surface to-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-l-4 border-brand/60 px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">蒸馏</h2>
        <button
          type="button"
          className="text-muted hover:text-ink"
          aria-label="说明"
          onClick={() => setHintOpen((v) => !v)}
        >
          ⓘ
        </button>
        {!readOnly ? (
          <div className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              title="快速学习（AI）：更新词云与摘要"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-dawn-md border border-line bg-surface px-2 py-1 text-[10px] text-ink hover:bg-fill disabled:opacity-50"
              onClick={() => onLearn("lite")}
            >
              <IconRotateCw width={12} height={12} className={busy ? "animate-spin" : ""} aria-hidden />
              快速
            </button>
            <button
              type="button"
              title="深度学习（AI）：提炼特色、场景与词云"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-dawn-md border border-brand/40 bg-brand/10 px-2 py-1 text-[10px] font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
              onClick={() => onLearn("full")}
            >
              <IconRotateCw width={12} height={12} className={busy ? "animate-spin" : ""} aria-hidden />
              深度学习（AI）
            </button>
          </div>
        ) : null}
      </div>
      {hintOpen ? (
        <p className="mx-3 mb-1 text-[10px] text-muted">
          事实与引用请用「知识库」；本页从简历与成稿蒸馏写法。快速/深度学习均调用 AI 提炼词云；深度学习另归纳特色与场景。未勾选「参与学习」的素材会被跳过；AI 失败时自动回退规则提炼。
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AuthorIpDistillVitality item={item} hint={hint} />

        <div className="shrink-0 py-1">
          <MaturityTriangleChart
            positioning={tri.positioning}
            experience={tri.experience}
            article={tri.article}
            traitsReady={tri.traitsReady}
            maturity={String(item.maturity)}
            tags={tags}
            highlightTags={highlightTags}
          />
        </div>

        <AuthorIpDistillDomains domains={domains} />

        <div className="mt-3 border-t border-line/50 pt-2">
          <p className="mb-1 px-2 text-xs font-medium text-muted">我的特色</p>
          <AuthorIpDistillTraits
            traits={traits}
            readOnly={readOnly}
            busy={busy}
            onToggle={onToggle}
            onRemove={onRemove}
          />
        </div>

        <div className="mt-2 pb-3">
          <AuthorIpDistillResolver ipId={ipId} disabled={readOnly || busy} />
        </div>
      </div>
    </section>
  );
}
