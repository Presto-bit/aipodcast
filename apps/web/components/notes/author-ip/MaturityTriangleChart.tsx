"use client";

import { useMemo } from "react";
import { cn } from "../../../lib/cn";
import { maturityLabel } from "./utils";

type Props = {
  positioning: boolean;
  experience: boolean;
  article: boolean;
  traitsReady: boolean;
  maturity: string;
  tags?: string[];
  highlightTags?: Set<string>;
};

const CX = 120;
const CY = 98;

export default function MaturityTriangleChart({
  positioning,
  experience,
  article,
  traitsReady,
  maturity,
  tags = [],
  highlightTags = new Set()
}: Props) {
  const center = maturityLabel(maturity);
  const strokeOn = "var(--color-brand, #6366f1)";
  const strokeOff = "var(--color-line, #e2e8f0)";
  const fillOn = "var(--color-brand, #6366f1)";
  const fillOff = "transparent";

  const orbitTags = useMemo(() => {
    const list = tags.filter(Boolean).slice(0, 10);
    if (list.length === 0) return [];
    const rx = 108;
    const ry = 78;
    return list.map((text, i) => {
      const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      return {
        text,
        x: CX + rx * Math.cos(angle),
        y: CY + ry * Math.sin(angle),
        highlight: highlightTags.has(text)
      };
    });
  }, [tags, highlightTags]);

  const node = (nx: number, ny: number, on: boolean, label: string) => (
    <g key={label}>
      <circle cx={nx} cy={ny} r={12} fill={on ? fillOn : fillOff} stroke={on ? strokeOn : strokeOff} strokeWidth={2} />
      <text x={nx} y={ny + 22} textAnchor="middle" className="fill-ink text-[9px] font-medium">
        {label}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 240 220" className="mx-auto h-[220px] w-full max-w-[280px]" role="img" aria-label={`蒸馏进度：${center}`}>
      {orbitTags.map((t, i) => (
        <g key={`${t.text}-${i}`}>
          {t.highlight ? (
            <circle cx={t.x} cy={t.y} r={22} fill="none" stroke={strokeOn} strokeWidth={1} opacity={0.35}>
              <animate attributeName="r" values="18;24;18" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.2;0.45;0.2" dur="2.5s" repeatCount="indefinite" />
            </circle>
          ) : null}
          <text
            x={t.x}
            y={t.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn(
              "select-none text-[10px] font-medium",
              t.highlight ? "fill-brand" : "fill-muted"
            )}
            style={{ fontSize: t.highlight ? 11 : 10 }}
          >
            {t.text.length > 8 ? `${t.text.slice(0, 7)}…` : t.text}
          </text>
        </g>
      ))}
      <polygon points="120,28 200,152 40,152" fill="none" stroke={strokeOff} strokeWidth={1.5} strokeDasharray="4 3" />
      <line x1="120" y1="40" x2="120" y2="62" stroke={positioning ? strokeOn : strokeOff} strokeWidth={positioning ? 2 : 1} />
      <line x1="110" y1="64" x2="76" y2="140" stroke={experience ? strokeOn : strokeOff} strokeWidth={experience ? 2 : 1} />
      <line x1="130" y1="64" x2="164" y2="140" stroke={article ? strokeOn : strokeOff} strokeWidth={article ? 2 : 1} />
      {node(120, 36, positioning, "定位")}
      {node(76, 148, experience, "简历")}
      {node(164, 148, article, "成稿")}
      <text x={CX} y={CY + 4} textAnchor="middle" className="fill-ink text-sm font-semibold">
        {center}
      </text>
      <text x={CX} y={CY + 20} textAnchor="middle" className="fill-muted text-[9px]">
        {traitsReady ? "特色已就绪" : "待补素材"}
      </text>
    </svg>
  );
}
