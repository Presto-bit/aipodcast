"use client";

import { useMemo } from "react";
import { cn } from "../../../lib/cn";
import { maturityLabel } from "./utils";

export type CenterCloudItem = {
  text: string;
  kind: "tag" | "trait" | "scene";
  highlight?: boolean;
};

type Props = {
  positioning: boolean;
  experience: boolean;
  article: boolean;
  traitsReady: boolean;
  maturity: string;
  centerItems?: CenterCloudItem[];
  highlightTags?: Set<string>;
};

const CX = 120;
const CY = 100;

export default function MaturityTriangleChart({
  positioning,
  experience,
  article,
  traitsReady,
  maturity,
  centerItems = [],
  highlightTags = new Set()
}: Props) {
  const center = maturityLabel(maturity);
  const strokeOn = "var(--color-brand, #6366f1)";
  const strokeOff = "var(--color-line, #e2e8f0)";
  const fillOn = "var(--color-brand, #6366f1)";
  const fillOff = "transparent";

  const innerCloud = useMemo(() => {
    const seen = new Set<string>();
    const list: CenterCloudItem[] = [];
    for (const item of centerItems) {
      const t = item.text.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      list.push({
        ...item,
        highlight: item.highlight || highlightTags.has(t)
      });
    }
    return list.slice(0, 14);
  }, [centerItems, highlightTags]);

  const placed = useMemo(() => {
    const n = innerCloud.length;
    if (n === 0) return [];
    const rx = 62;
    const ry = 42;
    return innerCloud.map((item, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return {
        ...item,
        x: CX + rx * Math.cos(angle),
        y: CY + ry * Math.sin(angle)
      };
    });
  }, [innerCloud]);

  const node = (nx: number, ny: number, on: boolean, label: string) => (
    <g key={label}>
      <circle cx={nx} cy={ny} r={12} fill={on ? fillOn : fillOff} stroke={on ? strokeOn : strokeOff} strokeWidth={2} />
      <text x={nx} y={ny + 22} textAnchor="middle" className="fill-ink text-[9px] font-medium">
        {label}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 240 240" className="mx-auto h-[240px] w-full max-w-[300px]" role="img" aria-label={`蒸馏：${center}`}>
      <polygon points="120,24 205,158 35,158" fill="none" stroke={strokeOff} strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1="120" y1="36" x2="120" y2="58" stroke={positioning ? strokeOn : strokeOff} strokeWidth={positioning ? 2 : 1} />
      <line x1="108" y1="60" x2="72" y2="146" stroke={experience ? strokeOn : strokeOff} strokeWidth={experience ? 2 : 1} />
      <line x1="132" y1="60" x2="168" y2="146" stroke={article ? strokeOn : strokeOff} strokeWidth={article ? 2 : 1} />
      {node(120, 32, positioning, "定位")}
      {node(72, 152, experience, "经历")}
      {node(168, 152, article, "成稿")}

      {placed.map((t, i) => (
        <g key={`${t.text}-${i}`}>
          {t.highlight ? (
            <circle cx={t.x} cy={t.y} r={20} fill="none" stroke={strokeOn} strokeWidth={1} opacity={0.3}>
              <animate attributeName="r" values="16;22;16" dur="2.5s" repeatCount="indefinite" />
            </circle>
          ) : null}
          <text
            x={t.x}
            y={t.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn(
              "select-none font-medium",
              t.kind === "scene" ? "fill-amber-700 dark:fill-amber-300" : "",
              t.kind === "trait" ? "fill-brand" : "",
              t.kind === "tag" ? "fill-muted" : "",
              t.highlight ? "text-[11px]" : "text-[10px]"
            )}
            style={{ fontSize: t.highlight ? 11 : 10 }}
          >
            {t.text.length > 9 ? `${t.text.slice(0, 8)}…` : t.text}
          </text>
        </g>
      ))}

      <text x={CX} y={CY - 6} textAnchor="middle" className="fill-ink text-xs font-semibold">
        {center}
      </text>
      <text x={CX} y={CY + 8} textAnchor="middle" className="fill-muted text-[9px]">
        {traitsReady ? "特色已就绪" : placed.length > 0 ? "词云 · 特色 · 场景" : "待补素材"}
      </text>
    </svg>
  );
}
