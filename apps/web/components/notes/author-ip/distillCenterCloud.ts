import type { AuthorIpItem } from "../../../lib/authorIp";
import type { CenterCloudItem } from "./MaturityTriangleChart";
import { domainsFromItem, formatLastLearnedAt, tagCloudFromItem, traitsFromItem } from "./utils";

const MAX_TOTAL = 22;

function pushUnique(items: CenterCloudItem[], seen: Set<string>, entry: CenterCloudItem) {
  const key = `${entry.kind}::${entry.text}`;
  if (!entry.text.trim() || seen.has(key)) return;
  seen.add(key);
  items.push(entry);
}

/** 将蒸馏结果全部收敛为三角图中心词云条目 */
export function buildDistillCenterCloud(
  item: AuthorIpItem,
  counts: { experience: number; article: number },
  highlightTags: Set<string>
): CenterCloudItem[] {
  const items: CenterCloudItem[] = [];
  const seen = new Set<string>();

  const prof = item.profile as {
    coldStart?: { whoAmI?: string; audience?: string };
  };
  const oneLiner = (item.oneLiner || "").trim();
  if (oneLiner) {
    pushUnique(items, seen, {
      text: oneLiner.length > 14 ? `${oneLiner.slice(0, 13)}…` : oneLiner,
      kind: "profile"
    });
  }
  const who = (prof.coldStart?.whoAmI || "").trim();
  const aud = (prof.coldStart?.audience || "").trim();
  if (who) {
    pushUnique(items, seen, {
      text: who.length > 10 ? `${who.slice(0, 9)}…` : who,
      kind: "profile"
    });
  }
  if (aud) {
    pushUnique(items, seen, {
      text: aud.length > 10 ? `${aud.slice(0, 9)}…` : aud,
      kind: "profile"
    });
  }

  for (const t of traitsFromItem(item)) {
    const label = String(t.label || "").trim();
    if (!label) continue;
    pushUnique(items, seen, {
      text: label.length > 12 ? `${label.slice(0, 11)}…` : label,
      kind: "trait",
      dimmed: t.defaultOn === false
    });
  }

  for (const d of domainsFromItem(item)) {
    const name = (d.displayName || "").trim();
    if (name) {
      pushUnique(items, seen, {
        text: name.length > 12 ? `${name.slice(0, 11)}…` : name,
        kind: "scene"
      });
    }
  }

  for (const tag of tagCloudFromItem(item)) {
    if (!tag) continue;
    pushUnique(items, seen, {
      text: tag,
      kind: "tag",
      highlight: highlightTags.has(tag)
    });
  }

  const v = (item.profile as { vitality?: Record<string, unknown> } | undefined)?.vitality;
  if (v && typeof v === "object") {
    const top3 = v.topContributors;
    if (Array.isArray(top3)) {
      for (const title of top3.slice(0, 3)) {
        const t = String(title || "").trim();
        if (!t) continue;
        pushUnique(items, seen, {
          text: t.length > 11 ? `${t.slice(0, 10)}…` : t,
          kind: "contributor"
        });
      }
    }
    const change = String(v.recentChange || "").trim();
    if (change) {
      const parts = change.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
      for (const part of (parts.length ? parts : [change]).slice(0, 2)) {
        pushUnique(items, seen, {
          text: part.length > 14 ? `${part.slice(0, 13)}…` : part,
          kind: "insight"
        });
      }
    }
    const summary = v.materialSummary as
      | { experienceCount?: number; articleCount?: number; learningCount?: number }
      | undefined;
    if (summary) {
      pushUnique(items, seen, {
        text: `素材${summary.learningCount ?? 0}条`,
        kind: "meta"
      });
      pushUnique(items, seen, {
        text: `经历${summary.experienceCount ?? counts.experience}·成稿${summary.articleCount ?? counts.article}`,
        kind: "meta"
      });
    }
    const learned = formatLastLearnedAt(v.lastLearnedAt as string | boolean | undefined);
    if (learned) {
      pushUnique(items, seen, { text: `学习于${learned}`, kind: "meta" });
    }
    const src = String(v.distillSource || "");
    if (src) {
      const label = src === "llm" ? "AI提炼" : src === "llm+heuristic" ? "AI+规则" : "规则提炼";
      pushUnique(items, seen, { text: label, kind: "meta" });
    }
  }

  if (items.length === 0 && counts.experience + counts.article === 0) {
    pushUnique(items, seen, { text: "待添加素材", kind: "meta" });
  }

  return items.slice(0, MAX_TOTAL);
}
