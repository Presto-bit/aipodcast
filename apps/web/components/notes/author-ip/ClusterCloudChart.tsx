"use client";

import { useMemo, useState } from "react";
import type { DistillCluster } from "./distillCenterCloud";

export type CloudClusterId = "positioning" | "style" | "scene" | "experience" | "insight";

export type CloudWordKind = "trait" | "scene" | "tag" | "contributor" | "insight" | "meta" | "profile";

export type ClusterCloudItem = {
  text: string;
  kind: CloudWordKind;
  highlight?: boolean;
  dimmed?: boolean;
};

const SECTOR_THEME: Record<CloudClusterId, { color: string; fill: string; hub: string }> = {
  positioning: { color: "#0f766e", fill: "rgba(15,118,110,0.1)", hub: "定位" },
  style: { color: "var(--color-brand, #6366f1)", fill: "rgba(99,102,241,0.1)", hub: "写作风格" },
  scene: { color: "#b45309", fill: "rgba(245,158,11,0.12)", hub: "场景" },
  experience: { color: "#0369a1", fill: "rgba(3,105,161,0.1)", hub: "经历" },
  insight: { color: "#7c3aed", fill: "rgba(124,58,237,0.1)", hub: "素材洞察" }
};

const CHIP_KIND: Record<CloudWordKind, { fontSize: number; weight: number; text: string; padX: number }> = {
  trait: { fontSize: 10, weight: 600, text: "var(--color-brand, #6366f1)", padX: 6 },
  tag: { fontSize: 9, weight: 500, text: "#475569", padX: 5 },
  scene: { fontSize: 9.5, weight: 600, text: "#b45309", padX: 5 },
  profile: { fontSize: 9.5, weight: 600, text: "#0f766e", padX: 5 },
  contributor: { fontSize: 8.5, weight: 500, text: "#4f46e5", padX: 5 },
  insight: { fontSize: 8.5, weight: 500, text: "#7c3aed", padX: 5 },
  meta: { fontSize: 8, weight: 400, text: "#94a3b8", padX: 4 }
};

const VIEW_W = 320;
const VIEW_H = 300;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2 + 4;
const R_INNER = 44;
const R_OUTER = 128;
const R_LABEL = 118;
const CENTER_R = 38;
const MAX_CHIPS = 5;
const SECTOR_GAP = 0.06;

type PlacedChip = {
  item: ClusterCloudItem;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function measureChip(label: string, kind: CloudWordKind) {
  const st = CHIP_KIND[kind];
  const w = label.length * (st.fontSize * 0.55) + st.padX * 2;
  const h = st.fontSize + 8;
  return { w: Math.min(w, 72), h, st };
}

function sectorPath(cx: number, cy: number, r0: number, r1: number, start: number, end: number) {
  const large = end - start > Math.PI ? 1 : 0;
  const x0 = cx + r0 * Math.cos(start);
  const y0 = cy + r0 * Math.sin(start);
  const x1 = cx + r1 * Math.cos(start);
  const y1 = cy + r1 * Math.sin(start);
  const x2 = cx + r1 * Math.cos(end);
  const y2 = cy + r1 * Math.sin(end);
  const x3 = cx + r0 * Math.cos(end);
  const y3 = cy + r0 * Math.sin(end);
  return `M ${x0} ${y0} A ${r0} ${r0} 0 ${large} 1 ${x3} ${y3} L ${x2} ${y2} A ${r1} ${r1} 0 ${large} 0 ${x1} ${y1} Z`;
}

function sectorAngles(index: number, total: number) {
  const slice = (Math.PI * 2) / total;
  const start = -Math.PI / 2 + index * slice + SECTOR_GAP / 2;
  const end = start + slice - SECTOR_GAP;
  const mid = (start + end) / 2;
  return { start, end, mid };
}

function layoutSectorChips(
  items: ClusterCloudItem[],
  start: number,
  end: number
): PlacedChip[] {
  const visible = items.slice(0, MAX_CHIPS);
  const extra = items.length - visible.length;
  const n = visible.length + (extra > 0 ? 1 : 0);
  if (n === 0) return [];

  const placed: PlacedChip[] = [];
  const span = end - start;

  for (let i = 0; i < visible.length; i += 1) {
    const item = visible[i];
    const label = truncate(item.text, item.kind === "meta" ? 11 : 10);
    const { w, h, st } = measureChip(label, item.kind);
    const t = (i + 0.5) / n;
    const angle = start + t * span;
    const ring = i % 2 === 0 ? 0.42 : 0.62;
    const r = R_INNER + 14 + ring * (R_OUTER - R_INNER - 28);
    placed.push({
      item,
      label,
      w,
      h,
      x: CX + r * Math.cos(angle),
      y: CY + r * Math.sin(angle)
    });
  }

  if (extra > 0) {
    const angle = start + ((visible.length + 0.5) / n) * span;
    const r = R_INNER + 0.55 * (R_OUTER - R_INNER);
    const label = `+${extra}`;
    const { w, h } = measureChip(label, "meta");
    placed.push({
      item: { text: label, kind: "meta" },
      label,
      w,
      h,
      x: CX + r * Math.cos(angle),
      y: CY + r * Math.sin(angle)
    });
  }

  return placed;
}

type Props = {
  clusters: DistillCluster[];
  centerTitle: string;
  maturityLabel: string;
};

export default function ClusterCloudChart({ clusters, centerTitle, maturityLabel }: Props) {
  const [hovered, setHovered] = useState<CloudClusterId | null>(null);
  const active = clusters.filter((c) => c.items.length > 0);

  const layout = useMemo(() => {
    return active.map((cluster, i) => {
      const angles = sectorAngles(i, active.length);
      const theme = SECTOR_THEME[cluster.id];
      const chips = layoutSectorChips(cluster.items, angles.start, angles.end);
      const lx = CX + R_LABEL * Math.cos(angles.mid);
      const ly = CY + R_LABEL * Math.sin(angles.mid);
      return { cluster, angles, theme, chips, lx, ly };
    });
  }, [active]);

  if (active.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted">
        添加素材并更新特色后，此处将展示你的风格辐射图
      </div>
    );
  }

  const title = truncate(centerTitle.trim() || "我的 IP", 8);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="mx-auto h-full min-h-[240px] w-full max-w-[400px] flex-1"
        role="img"
        aria-label={`风格辐射图：${title}，${maturityLabel}`}
      >
        <circle cx={CX} cy={CY} r={R_OUTER + 6} fill="none" stroke="var(--color-line, #e2e8f0)" strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />

        {layout.map(({ cluster, angles, theme, chips, lx, ly }) => {
          const dim = hovered && hovered !== cluster.id;
          return (
            <g
              key={cluster.id}
              opacity={dim ? 0.28 : 1}
              onMouseEnter={() => setHovered(cluster.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ transition: "opacity 0.2s ease" }}
            >
              <path
                d={sectorPath(CX, CY, R_INNER, R_OUTER, angles.start, angles.end)}
                fill={theme.fill}
                stroke={theme.color}
                strokeWidth={hovered === cluster.id ? 1.2 : 0.6}
                strokeOpacity={hovered === cluster.id ? 0.55 : 0.25}
              />
              <line
                x1={CX + CENTER_R * Math.cos(angles.mid)}
                y1={CY + CENTER_R * Math.sin(angles.mid)}
                x2={CX + (R_INNER - 4) * Math.cos(angles.mid)}
                y2={CY + (R_INNER - 4) * Math.sin(angles.mid)}
                stroke={theme.color}
                strokeWidth={1}
                strokeOpacity={0.35}
              />
              <g transform={`translate(${lx}, ${ly})`}>
                <rect
                  x={-theme.hub.length * 4.2}
                  y={-8}
                  width={theme.hub.length * 8.4}
                  height={16}
                  rx={8}
                  fill="var(--color-surface, #fff)"
                  stroke={theme.color}
                  strokeWidth={1}
                  opacity={0.95}
                />
                <text textAnchor="middle" dominantBaseline="middle" fill={theme.color} fontSize={9} fontWeight={700}>
                  {theme.hub}
                </text>
              </g>
              {chips.map((chip, i) => {
                const st = CHIP_KIND[chip.item.kind];
                const fill =
                  chip.item.kind === "meta"
                    ? "rgba(148,163,184,0.12)"
                    : chip.item.highlight
                      ? "rgba(99,102,241,0.18)"
                      : "var(--color-surface, #fff)";
                const stroke = chip.item.highlight ? theme.color : "var(--color-line, #e2e8f0)";
                return (
                  <g
                    key={`${cluster.id}-chip-${i}`}
                    transform={`translate(${chip.x}, ${chip.y})`}
                    opacity={chip.item.dimmed ? 0.4 : 1}
                  >
                    <rect
                      x={-chip.w / 2}
                      y={-chip.h / 2}
                      width={chip.w}
                      height={chip.h}
                      rx={5}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={chip.item.highlight ? 1.2 : 0.8}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={st.text}
                      fontSize={st.fontSize}
                      fontWeight={st.weight}
                    >
                      {chip.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        <circle cx={CX} cy={CY} r={CENTER_R + 4} fill="var(--color-surface, #fff)" stroke="var(--color-brand, #6366f1)" strokeWidth={1.5} strokeOpacity={0.35} />
        <circle cx={CX} cy={CY} r={CENTER_R} fill="var(--color-surface, #fff)" stroke="var(--color-line, #e2e8f0)" strokeWidth={1} />
        <text x={CX} y={CY - 5} textAnchor="middle" dominantBaseline="middle" fill="var(--color-ink, #0f172a)" fontSize={11} fontWeight={700}>
          {title}
        </text>
        <text x={CX} y={CY + 9} textAnchor="middle" dominantBaseline="middle" fill="var(--color-muted, #64748b)" fontSize={8} fontWeight={500}>
          {maturityLabel}
        </text>
      </svg>
    </div>
  );
}
