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
};

const CLUSTER_LAYOUT: Record<
  CloudClusterId,
  { cx: number; cy: number; color: string; hub: string }
> = {
  positioning: { cx: 72, cy: 58, color: "#0f766e", hub: "定位" },
  style: { cx: 148, cy: 42, color: "var(--color-brand, #6366f1)", hub: "写作风格" },
  scene: { cx: 228, cy: 58, color: "#b45309", hub: "场景" },
  experience: { cx: 72, cy: 168, color: "#0369a1", hub: "经历" },
  insight: { cx: 228, cy: 168, color: "#7c3aed", hub: "素材洞察" }
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

function measure(text: string, fontSize: number) {
  return { w: text.length * fontSize * 0.58 + 8, h: fontSize + 6 };
}

function overlaps(a: PlacedWord, b: PlacedWord, pad = 4) {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
  );
}

function layoutCluster(
  cluster: DistillCluster,
  tick: number
): PlacedWord[] {
  const hub = CLUSTER_LAYOUT[cluster.id];
  const placed: PlacedWord[] = [];
  const maxR = cluster.id === "style" ? 52 : 44;

  cluster.items.forEach((item, i) => {
    const style = KIND_STYLE[item.kind];
    const label = item.text.length > 14 ? `${item.text.slice(0, 13)}…` : item.text;
    const { w, h } = measure(label, style.size);
    let x = hub.cx;
    let y = hub.cy;
    let ok = false;
    for (let ring = 0; ring < 6 && !ok; ring += 1) {
      const count = Math.max(6, ring * 4 + 2);
      for (let j = 0; j < count; j += 1) {
        const angle = (j / count) * Math.PI * 2 + i * 0.7 + ring * 0.35;
        const r = 18 + ring * 11;
        const cx = hub.cx + r * Math.cos(angle);
        const cy = hub.cy + r * Math.sin(angle) * 0.85;
        if (Math.hypot(cx - hub.cx, cy - hub.cy) > maxR) continue;
        const candidate: PlacedWord = {
          ...item,
          text: label,
          x: cx,
          y: cy,
          fontSize: style.size,
          w,
          h,
          phase: i * 1.3 + j * 0.2
        };
        if (!placed.some((p) => overlaps(p, candidate))) {
          placed.push(candidate);
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      placed.push({
        ...item,
        text: label,
        x: hub.cx + ((i % 3) - 1) * 14,
        y: hub.cy + Math.floor(i / 3) * 12 - 8,
        fontSize: style.size,
        w,
        h,
        phase: i
      });
    }
  });

  const drift = 1.8;
  return placed.map((p) => ({
    ...p,
    x: p.x + Math.sin(tick * 0.0012 + p.phase) * drift,
    y: p.y + Math.cos(tick * 0.001 + p.phase * 1.1) * drift * 0.7
  }));
}

type Props = {
  clusters: DistillCluster[];
  maturityLabel: string;
};

export default function ClusterCloudChart({ clusters, maturityLabel }: Props) {
  const [tick, setTick] = useState(0);

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

  const placedByCluster = useMemo(() => {
    const map = new Map<CloudClusterId, PlacedWord[]>();
    for (const c of clusters) {
      map.set(c.id, layoutCluster(c, tick));
    }
    return map;
  }, [clusters, tick]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg
        viewBox="0 0 300 220"
        className="mx-auto h-full min-h-[200px] w-full max-w-[360px] flex-1"
        role="img"
        aria-label={`蒸馏词云：${maturityLabel}`}
      >
        {clusters.map((cluster) => {
          const hub = CLUSTER_LAYOUT[cluster.id];
          const words = placedByCluster.get(cluster.id) || [];
          return (
            <g key={cluster.id}>
              <circle cx={hub.cx} cy={hub.cy} r={34} fill={`${hub.color}14`} stroke={hub.color} strokeWidth={1} strokeOpacity={0.35} />
              <circle cx={hub.cx} cy={hub.cy} r={20} fill="var(--color-surface, #fff)" stroke={hub.color} strokeWidth={1.5} />
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
              {words.map((w, i) => {
                const style = KIND_STYLE[w.kind];
                return (
                  <g key={`${cluster.id}-${w.text}-${i}`} opacity={w.dimmed ? 0.38 : 1}>
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
        <text x={150} y={112} textAnchor="middle" fill="var(--color-muted, #94a3b8)" fontSize={9}>
          {maturityLabel}
        </text>
      </svg>
    </div>
  );
}
