"use client";

import { useEffect, useMemo, useState } from "react";
import type { DistillCluster } from "./distillCenterCloud";

export type CloudClusterId = "positioning" | "style" | "scene" | "experience" | "insight";

export type CloudWordKind = "trait" | "scene" | "tag" | "contributor" | "insight" | "meta" | "profile";

export type ClusterCloudItem = {
  text: string;
  kind: CloudWordKind;
  highlight?: boolean;
  dimmed?: boolean;
};

type PlacedWord = ClusterCloudItem & {
  x: number;
  y: number;
  fontSize: number;
  w: number;
  h: number;
  phase: number;
  clusterId: CloudClusterId;
};

type HubLayout = {
  id: CloudClusterId;
  cx: number;
  cy: number;
  color: string;
  hub: string;
};

const HUB_STYLE: Record<CloudClusterId, { color: string; hub: string }> = {
  positioning: { color: "#0f766e", hub: "定位" },
  style: { color: "var(--color-brand, #6366f1)", hub: "写作风格" },
  scene: { color: "#b45309", hub: "场景" },
  experience: { color: "#0369a1", hub: "经历" },
  insight: { color: "#7c3aed", hub: "素材洞察" }
};

const KIND_STYLE: Record<CloudWordKind, { size: number; weight: number; fill: string; italic?: boolean }> = {
  trait: { size: 11, weight: 600, fill: "var(--color-brand, #6366f1)" },
  tag: { size: 9, weight: 500, fill: "#64748b" },
  scene: { size: 10, weight: 600, fill: "#b45309" },
  profile: { size: 9.5, weight: 600, fill: "#0f766e" },
  contributor: { size: 8.5, weight: 500, fill: "#4f46e5" },
  insight: { size: 8.5, weight: 500, fill: "#7c3aed", italic: true },
  meta: { size: 8, weight: 400, fill: "#94a3b8" }
};

const VIEW_W = 300;
const VIEW_H = 220;
const HUB_R = 24;
const CENTER = { x: VIEW_W / 2, y: VIEW_H / 2 };

function measure(text: string, fontSize: number) {
  return { w: text.length * fontSize * 0.58 + 8, h: fontSize + 6 };
}

function overlaps(a: PlacedWord, b: PlacedWord, pad = 5) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
  );
}

function tooCloseToHub(x: number, y: number, hub: HubLayout, minR = HUB_R + 10) {
  return Math.hypot(x - hub.cx, y - hub.cy) < minR;
}

/** 按活跃聚类数量自动排布中心点（圆周分布） */
function computeHubLayouts(clusters: DistillCluster[]): HubLayout[] {
  const n = clusters.length;
  if (n === 0) return [];
  if (n === 1) {
    const c = clusters[0];
    const style = HUB_STYLE[c.id];
    return [{ id: c.id, cx: CENTER.x, cy: CENTER.y, ...style }];
  }
  const ringR = n <= 3 ? 72 : n === 4 ? 78 : 82;
  return clusters.map((c, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const style = HUB_STYLE[c.id];
    return {
      id: c.id,
      cx: CENTER.x + ringR * Math.cos(angle),
      cy: CENTER.y + ringR * Math.sin(angle) * 0.82,
      ...style
    };
  });
}

function layoutAllClusters(clusters: DistillCluster[], hubs: HubLayout[], tick: number): PlacedWord[] {
  const hubById = new Map(hubs.map((h) => [h.id, h]));
  const placed: PlacedWord[] = [];
  const drift = 1.5;

  for (const cluster of clusters) {
    const hub = hubById.get(cluster.id);
    if (!hub) continue;
    const maxR = cluster.id === "style" ? 48 : 40;

    cluster.items.forEach((item, i) => {
      const style = KIND_STYLE[item.kind];
      const label = item.text.length > 14 ? `${item.text.slice(0, 13)}…` : item.text;
      const { w, h } = measure(label, style.size);
      let placedOne: PlacedWord | null = null;

      for (let ring = 0; ring < 7 && !placedOne; ring += 1) {
        const slots = Math.max(5, ring * 3 + 4);
        for (let j = 0; j < slots; j += 1) {
          const angle = (j / slots) * Math.PI * 2 + i * 0.65 + ring * 0.4;
          const r = HUB_R + 8 + ring * 10;
          const x = hub.cx + r * Math.cos(angle);
          const y = hub.cy + r * Math.sin(angle) * 0.88;
          if (Math.hypot(x - hub.cx, y - hub.cy) > maxR) continue;
          if (tooCloseToHub(x, y, hub)) continue;
          const candidate: PlacedWord = {
            ...item,
            text: label,
            x,
            y,
            fontSize: style.size,
            w,
            h,
            phase: i * 1.2 + j * 0.15,
            clusterId: cluster.id
          };
          const hitWord = placed.some((p) => overlaps(p, candidate));
          const hitHub = hubs.some(
            (other) => other.id !== hub.id && tooCloseToHub(x, y, other, HUB_R + 6)
          );
          if (!hitWord && !hitHub) {
            placedOne = candidate;
            break;
          }
        }
      }

      if (!placedOne) {
        placedOne = {
          ...item,
          text: label,
          x: hub.cx + ((i % 3) - 1) * 16,
          y: hub.cy + 28 + Math.floor(i / 3) * 11,
          fontSize: style.size,
          w,
          h,
          phase: i,
          clusterId: cluster.id
        };
      }
      placed.push(placedOne);
    });
  }

  return placed.map((p) => ({
    ...p,
    x: p.x + Math.sin(tick * 0.0011 + p.phase) * drift,
    y: p.y + Math.cos(tick * 0.00095 + p.phase) * drift * 0.75
  }));
}

type Props = {
  clusters: DistillCluster[];
  maturityLabel: string;
};

export default function ClusterCloudChart({ clusters, maturityLabel }: Props) {
  const [tick, setTick] = useState(0);
  const active = clusters.filter((c) => c.items.length > 0);

  useEffect(() => {
    let mounted = true;
    let frameId = 0;
    const loop = (t: number) => {
      if (!mounted) return;
      setTick(t);
      frameId = window.requestAnimationFrame(loop);
    };
    frameId = window.requestAnimationFrame(loop);
    return () => {
      mounted = false;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const hubs = useMemo(() => computeHubLayouts(active), [active]);
  const words = useMemo(() => layoutAllClusters(active, hubs, tick), [active, hubs, tick]);
  const wordsByCluster = useMemo(() => {
    const map = new Map<CloudClusterId, PlacedWord[]>();
    for (const w of words) {
      const list = map.get(w.clusterId) || [];
      list.push(w);
      map.set(w.clusterId, list);
    }
    return map;
  }, [words]);

  if (active.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted">
        添加素材并更新特色后，此处将展示蒸馏词云
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="mx-auto h-full min-h-[200px] w-full max-w-[360px] flex-1"
        role="img"
        aria-label={`蒸馏词云：${maturityLabel}`}
      >
        {hubs.map((hub) => {
          const clusterWords = wordsByCluster.get(hub.id) || [];
          return (
            <g key={hub.id}>
              <circle cx={hub.cx} cy={hub.cy} r={36} fill={`${hub.color}12`} stroke={hub.color} strokeWidth={1} strokeOpacity={0.3} />
              <circle cx={hub.cx} cy={hub.cy} r={HUB_R} fill="var(--color-surface, #fff)" stroke={hub.color} strokeWidth={1.5} />
              <text
                x={hub.cx}
                y={hub.cy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={hub.color}
                fontSize={9}
                fontWeight={700}
              >
                {hub.hub}
              </text>
              {clusterWords.map((w, i) => {
                const style = KIND_STYLE[w.kind];
                return (
                  <g key={`${hub.id}-${w.text}-${i}`} opacity={w.dimmed ? 0.38 : 1}>
                    {w.highlight ? (
                      <circle cx={w.x} cy={w.y} r={14} fill="none" stroke={hub.color} strokeWidth={1} opacity={0.4}>
                        <animate attributeName="r" values="10;16;10" dur="2.2s" repeatCount="indefinite" />
                      </circle>
                    ) : null}
                    <text
                      x={w.x}
                      y={w.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={style.fill}
                      fontSize={w.fontSize}
                      fontWeight={style.weight}
                      fontStyle={style.italic ? "italic" : "normal"}
                    >
                      {w.text}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {active.length > 1 ? (
          <text x={CENTER.x} y={CENTER.y} textAnchor="middle" dominantBaseline="middle" fill="var(--color-muted, #94a3b8)" fontSize={8}>
            {maturityLabel}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
