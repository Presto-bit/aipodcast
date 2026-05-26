"use client";

import { maturityLabel } from "./utils";

type Props = {
  positioning: boolean;
  experience: boolean;
  article: boolean;
  traitsReady: boolean;
  maturity: string;
};

export default function MaturityTriangleChart({ positioning, experience, article, traitsReady, maturity }: Props) {
  const center = maturityLabel(maturity);
  const strokeOn = "var(--color-brand, #6366f1)";
  const strokeOff = "var(--color-line, #e2e8f0)";
  const fillOn = "var(--color-brand, #6366f1)";
  const fillOff = "transparent";

  const node = (cx: number, cy: number, on: boolean, label: string) => (
    <g key={label}>
      <circle cx={cx} cy={cy} r={14} fill={on ? fillOn : fillOff} stroke={on ? strokeOn : strokeOff} strokeWidth={2} />
      <text x={cx} y={cy + 28} textAnchor="middle" className="fill-ink text-[10px] font-medium">
        {label}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 240 200" className="mx-auto h-[180px] w-full max-w-[240px]" role="img" aria-label={`蒸馏进度：${center}`}>
      <polygon
        points="120,24 210,150 30,150"
        fill="none"
        stroke={strokeOff}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <line x1="120" y1="38" x2="120" y2="70" stroke={positioning ? strokeOn : strokeOff} strokeWidth={positioning ? 2 : 1} />
      <line x1="108" y1="72" x2="72" y2="138" stroke={experience ? strokeOn : strokeOff} strokeWidth={experience ? 2 : 1} />
      <line x1="132" y1="72" x2="168" y2="138" stroke={article ? strokeOn : strokeOff} strokeWidth={article ? 2 : 1} />
      {node(120, 32, positioning, "定位")}
      {node(72, 148, experience, "经历")}
      {node(168, 148, article, "成稿")}
      <text x="120" y="105" textAnchor="middle" className="fill-ink text-sm font-semibold">
        {center}
      </text>
      <text x="120" y="122" textAnchor="middle" className="fill-muted text-[10px]">
        {traitsReady ? "特色已就绪" : "待补素材"}
      </text>
    </svg>
  );
}
