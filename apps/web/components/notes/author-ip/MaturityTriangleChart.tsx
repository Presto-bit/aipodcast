"use client";

import { useMemo } from "react";
import { maturityLabel } from "./utils";

export type CenterCloudKind = "trait" | "scene" | "tag" | "contributor" | "insight" | "meta" | "profile";

export type CenterCloudItem = {
  text: string;
  kind: CenterCloudKind;
  highlight?: boolean;
  /** 未启用的特色 */
  dimmed?: boolean;
};

type Props = {
  positioning: boolean;
  experience: boolean;
  article: boolean;
  maturity: string;
  centerItems?: CenterCloudItem[];
};

const CX = 120;
const CY = 102;

const RING_RADIUS: Record<CenterCloudKind, number> = {
  trait: 36,
  profile: 48,
  scene: 58,
  insight: 54,
  tag: 68,
  contributor: 74,
  meta: 80
};

const KIND_STYLE: Record<
  CenterCloudKind,
  { fill: string; size: number; weight: number; pill?: string; italic?: boolean }
> = {
  trait: { fill: "var(--color-brand, #6366f1)", size: 11, weight: 600, pill: "rgba(99,102,241,0.12)" },
  scene: { fill: "#b45309", size: 10, weight: 600, pill: "rgba(245,158,11,0.14)" },
  tag: { fill: "#64748b", size: 9, weight: 500 },
  contributor: { fill: "#4f46e5", size: 8.5, weight: 500, pill: "rgba(79,70,229,0.1)" },
  insight: { fill: "#7c3aed", size: 8.5, weight: 500, italic: true },
  meta: { fill: "#94a3b8", size: 8, weight: 400 },
  profile: { fill: "#0f766e", size: 9.5, weight: 600, pill: "rgba(13,148,136,0.12)" }
};

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function MaturityTriangleChart({
  positioning,
  experience,
  article,
  maturity,
  centerItems = []
}: Props) {
  const center = maturityLabel(maturity);
  const strokeOn = "var(--color-brand, #6366f1)";
  const strokeOff = "var(--color-line, #e2e8f0)";
  const fillOn = "var(--color-brand, #6366f1)";
  const fillOff = "transparent";

  const placed = useMemo(() => {
    const byKind: Record<CenterCloudKind, CenterCloudItem[]> = {
      trait: [],
      scene: [],
      tag: [],
      contributor: [],
      insight: [],
      meta: [],
      profile: []
    };
    const seen = new Set<string>();
    for (const item of centerItems) {
      const t = item.text.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      byKind[item.kind].push(item);
    }

    const out: Array<CenterCloudItem & { x: number; y: number }> = [];
    (Object.keys(byKind) as CenterCloudKind[]).forEach((kind) => {
      const list = byKind[kind];
      const r = RING_RADIUS[kind];
      list.forEach((item, i) => {
        const angle = (i / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2 + (kind.charCodeAt(0) % 5) * 0.08;
        out.push({
          ...item,
          x: CX + r * Math.cos(angle),
          y: CY + r * Math.sin(angle) * 0.88
        });
      });
    });
    return out;
  }, [centerItems]);

  const node = (nx: number, ny: number, on: boolean, label: string) => (
    <g key={label}>
      <circle cx={nx} cy={ny} r={12} fill={on ? fillOn : fillOff} stroke={on ? strokeOn : strokeOff} strokeWidth={2} />
      <text x={nx} y={ny + 22} textAnchor="middle" fill="var(--color-ink, #0f172a)" fontSize={9} fontWeight={500}>
        {label}
      </text>
    </g>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg
        viewBox="0 0 240 248"
        className="mx-auto h-full min-h-[220px] w-full max-w-[320px] flex-1"
        role="img"
        aria-label={`蒸馏词云：${center}`}
      >
        <polygon points="120,22 208,162 32,162" fill="none" stroke={strokeOff} strokeWidth={1.5} strokeDasharray="4 3" />
        <line x1="120" y1="34" x2="120" y2="56" stroke={positioning ? strokeOn : strokeOff} strokeWidth={positioning ? 2 : 1} />
        <line x1="106" y1="58" x2="68" y2="150" stroke={experience ? strokeOn : strokeOff} strokeWidth={experience ? 2 : 1} />
        <line x1="134" y1="58" x2="172" y2="150" stroke={article ? strokeOn : strokeOff} strokeWidth={article ? 2 : 1} />
        {node(120, 30, positioning, "定位")}
        {node(68, 154, experience, "经历")}
        {node(172, 154, article, "成稿")}

        {placed.map((t, i) => {
          const style = KIND_STYLE[t.kind];
          const label = truncate(t.text, t.kind === "meta" ? 12 : 10);
          const w = label.length * (style.size * 0.55);
          const opacity = t.dimmed ? 0.38 : 1;
          return (
            <g key={`${t.kind}-${t.text}-${i}`} opacity={opacity}>
              {t.highlight ? (
                <circle cx={t.x} cy={t.y} r={18} fill="none" stroke={strokeOn} strokeWidth={1} opacity={0.35}>
                  <animate attributeName="r" values="14;20;14" dur="2.5s" repeatCount="indefinite" />
                </circle>
              ) : null}
              {style.pill ? (
                <rect
                  x={t.x - w / 2 - 3}
                  y={t.y - style.size / 2 - 3}
                  width={w + 6}
                  height={style.size + 6}
                  rx={4}
                  fill={style.pill}
                />
              ) : null}
              <text
                x={t.x}
                y={t.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={style.fill}
                fontSize={style.size}
                fontWeight={style.weight}
                fontStyle={style.italic ? "italic" : "normal"}
              >
                {label}
              </text>
            </g>
          );
        })}

        <circle cx={CX} cy={CY} r={22} fill="var(--color-surface, #fff)" stroke={strokeOff} strokeWidth={1} />
        <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="middle" fill="var(--color-ink)" fontSize={11} fontWeight={700}>
          {center}
        </text>
      </svg>
    </div>
  );
}
