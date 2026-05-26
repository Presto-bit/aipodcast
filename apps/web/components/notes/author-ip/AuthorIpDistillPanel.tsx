"use client";

import { useMemo, useState } from "react";
import { IconRotateCw } from "../../icons";
import type { AuthorIpItem } from "../../../lib/authorIp";
import AuthorIpDistillVitality from "./AuthorIpDistillVitality";
import MaturityTriangleChart, { type CenterCloudItem } from "./MaturityTriangleChart";
import {
  domainsFromItem,
  maturityDistillHint,
  tagCloudFromItem,
  traitsFromItem,
  triangleState
} from "./utils";

type Props = {
  item: AuthorIpItem;
  counts: { experience: number; article: number };
  readOnly: boolean;
  busy: boolean;
  highlightTags: Set<string>;
  onLearn: () => void;
};

export default function AuthorIpDistillPanel({
  item,
  counts,
  readOnly,
  busy,
  highlightTags,
  onLearn
}: Props) {
  const [hintOpen, setHintOpen] = useState(false);

  const tri = triangleState(item, counts);
  const tags = tagCloudFromItem(item);
  const domains = domainsFromItem(item);
  const traits = traitsFromItem(item);
  const hint = maturityDistillHint(item, counts);

  const centerItems = useMemo((): CenterCloudItem[] => {
    const items: CenterCloudItem[] = [];
    for (const d of domains) {
      const name = (d.displayName || "").trim();
      if (name) items.push({ text: name, kind: "scene" });
    }
    for (const t of traits) {
      if (t.defaultOn === false) continue;
      const label = String(t.label || "").trim();
      if (label) items.push({ text: label, kind: "trait" });
    }
    for (const tag of tags) {
      if (tag) items.push({ text: tag, kind: "tag" });
    }
    return items;
  }, [domains, traits, tags]);

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
          <button
            type="button"
            title="根据素材 AI 更新词云、特色与场景"
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 rounded-dawn-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
            onClick={onLearn}
          >
            <IconRotateCw width={14} height={14} className={busy ? "animate-spin" : ""} aria-hidden />
            更新特色
          </button>
        ) : null}
      </div>
      {hintOpen ? (
        <p className="mx-3 mb-1 text-[10px] text-muted">
          事实与引用请用「知识库」。中间词云汇聚特色、场景与关键词；添加素材后点「更新特色」解析你的写作风格。未参与学习的素材会被跳过。
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
            centerItems={centerItems}
            highlightTags={highlightTags}
          />
        </div>
      </div>
    </section>
  );
}
