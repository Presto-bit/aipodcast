import type { AuthorIpItem } from "../../../lib/authorIp";
import type { CloudClusterId, ClusterCloudItem } from "./ClusterCloudChart";
import { domainsFromItem, formatLastLearnedAt, tagCloudFromItem, traitsFromItem } from "./utils";

const MAX_PER_CLUSTER = 8;

export type DistillCluster = {
  id: CloudClusterId;
  label: string;
  items: ClusterCloudItem[];
};

function pushUnique(items: ClusterCloudItem[], seen: Set<string>, entry: ClusterCloudItem) {
  const key = `${entry.kind}::${entry.text}`;
  if (!entry.text.trim() || seen.has(key)) return;
  seen.add(key);
  items.push(entry);
}

function cap(items: ClusterCloudItem[]) {
  return items.slice(0, MAX_PER_CLUSTER);
}

/** 将蒸馏结果按聚类分组，供聚类词云图展示 */
export function buildDistillClusterCloud(
  item: AuthorIpItem,
  counts: { experience: number; article: number },
  highlightTags: Set<string>
): DistillCluster[] {
  const seen = new Set<string>();
  const positioning: ClusterCloudItem[] = [];
  const style: ClusterCloudItem[] = [];
  const scene: ClusterCloudItem[] = [];
  const experience: ClusterCloudItem[] = [];
  const insight: ClusterCloudItem[] = [];

  const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string } };
  const oneLiner = (item.oneLiner || "").trim();
  if (oneLiner) {
    pushUnique(positioning, seen, {
      text: oneLiner.length > 16 ? `${oneLiner.slice(0, 15)}…` : oneLiner,
      kind: "profile"
    });
  }
  const who = (prof.coldStart?.whoAmI || "").trim();
  const aud = (prof.coldStart?.audience || "").trim();
  if (who) {
    pushUnique(positioning, seen, {
      text: who.length > 12 ? `${who.slice(0, 11)}…` : who,
      kind: "profile"
    });
  }
  if (aud) {
    pushUnique(positioning, seen, {
      text: aud.length > 12 ? `${aud.slice(0, 11)}…` : aud,
      kind: "profile"
    });
  }

  for (const t of traitsFromItem(item)) {
    const label = String(t.label || "").trim();
    if (!label) continue;
    pushUnique(style, seen, {
      text: label.length > 14 ? `${label.slice(0, 13)}…` : label,
      kind: "trait",
      dimmed: t.defaultOn === false
    });
  }

  for (const tag of tagCloudFromItem(item)) {
    if (!tag) continue;
    pushUnique(style, seen, {
      text: tag,
      kind: "tag",
      highlight: highlightTags.has(tag)
    });
  }

  for (const d of domainsFromItem(item)) {
    const name = (d.displayName || "").trim();
    if (name) {
      pushUnique(scene, seen, {
        text: name.length > 14 ? `${name.slice(0, 13)}…` : name,
        kind: "scene"
      });
    }
  }

  if (counts.experience > 0) {
    pushUnique(experience, seen, { text: `${counts.experience}段经历`, kind: "meta" });
  } else {
    pushUnique(experience, seen, { text: "待补充经历", kind: "meta" });
  }

  const v = (item.profile as { vitality?: Record<string, unknown> } | undefined)?.vitality;
  if (v && typeof v === "object") {
    const top3 = v.topContributors;
    if (Array.isArray(top3)) {
      for (const title of top3.slice(0, 3)) {
        const t = String(title || "").trim();
        if (!t) continue;
        pushUnique(insight, seen, {
          text: t.length > 12 ? `${t.slice(0, 11)}…` : t,
          kind: "contributor"
        });
      }
    }
    const change = String(v.recentChange || "").trim();
    if (change) {
      const parts = change.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
      for (const part of (parts.length ? parts : [change]).slice(0, 2)) {
        pushUnique(insight, seen, {
          text: part.length > 16 ? `${part.slice(0, 15)}…` : part,
          kind: "insight"
        });
      }
    }
    const summary = v.materialSummary as
      | { experienceCount?: number; articleCount?: number; learningCount?: number }
      | undefined;
    if (summary) {
      pushUnique(insight, seen, { text: `可学习${summary.learningCount ?? 0}条`, kind: "meta" });
    }
    const learned = formatLastLearnedAt(v.lastLearnedAt as string | boolean | undefined);
    if (learned) {
      pushUnique(insight, seen, { text: `学习于${learned}`, kind: "meta" });
    }
    const src = String(v.distillSource || "");
    if (src) {
      const label = src === "llm" ? "AI提炼" : src === "llm+heuristic" ? "AI+规则" : "规则提炼";
      pushUnique(insight, seen, { text: label, kind: "meta" });
    }
  }

  if (counts.article > 0) {
    pushUnique(insight, seen, { text: `${counts.article}篇成稿`, kind: "meta" });
  }

  const clusters: DistillCluster[] = [
    { id: "positioning", label: "定位", items: cap(positioning) },
    { id: "style", label: "写作风格", items: cap(style) },
    { id: "scene", label: "场景", items: cap(scene) },
    { id: "experience", label: "经历", items: cap(experience) },
    { id: "insight", label: "素材洞察", items: cap(insight) }
  ];

  const hasAny = clusters.some((c) => c.items.length > 0);
  if (!hasAny) {
    return clusters.map((c) =>
      c.id === "insight" ? { ...c, items: [{ text: "添加素材后更新", kind: "meta" as const }] } : c
    );
  }
  return clusters;
}
