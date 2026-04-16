"use client";

import { useEffect, useRef } from "react";
import type { ClipWord } from "../../lib/clipTypes";

type Props = {
  word: ClipWord | null;
  anchor: DOMRect | null;
  onClose: () => void;
  title: string;
  hint: string;
};

/** 长按词块：毫秒级波形 Mock（Canvas），与真实切片解耦 */
export default function MicroWavePopover({ word, anchor, onClose, title, hint }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!word || !anchor || !canvasRef.current) return undefined;
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const fill =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue("--dawn-fill").trim() || "#f1f5f9"
        : "#f1f5f9";
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    const bars = 48;
    const step = w / bars;
    const seed = word.id.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const brand =
      typeof window !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue("--dawn-brand").trim() || "#6366f1"
        : "#6366f1";
    for (let i = 0; i < bars; i++) {
      const pseudo = ((Math.sin(seed * 0.01 + i * 0.35) + 1) / 2) * h * 0.75 + 4;
      ctx.fillStyle = brand;
      ctx.globalAlpha = 0.35 + (i % 5) * 0.08;
      ctx.fillRect(i * step + 1, h - pseudo, Math.max(1, step - 2), pseudo);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = brand;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.35);
    ctx.lineTo(w, h * 0.35);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [word, anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!word || !anchor) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const width = Math.min(320, vw - 24);
  const left = Math.min(Math.max(12, anchor.left + anchor.width / 2 - width / 2), vw - width - 12);
  const top = Math.max(12, anchor.top - 140);

  return (
    <div className="fixed inset-0 z-[60] bg-canvas/70 backdrop-blur-[2px]" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed z-[61] overflow-hidden rounded-xl border border-line bg-surface shadow-modal"
        style={{ left, top, width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-3 py-2">
          <p className="text-xs font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-[10px] text-muted">{hint}</p>
        </div>
        <div className="p-3">
          <canvas ref={canvasRef} width={Math.floor(width - 24)} height={72} className="w-full rounded-md bg-fill" />
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            {`${word.text}${word.punct ?? ""}`.trim()} · {word.s_ms}–{word.e_ms} ms
          </p>
        </div>
      </div>
    </div>
  );
}
