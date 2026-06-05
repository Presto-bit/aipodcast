"use client";

import { useEffect, useState } from "react";

/** Cursor 式：灰色瞬态提示，数秒后淡出 */
export default function StudioEphemeralHint({
  text,
  ttlMs = 4500,
  className = ""
}: {
  text: string;
  ttlMs?: number;
  className?: string;
}) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    if (!text.trim()) {
      setPhase("gone");
      return;
    }
    setPhase("in");
    const fade = window.setTimeout(() => setPhase("out"), Math.max(800, ttlMs - 600));
    const gone = window.setTimeout(() => setPhase("gone"), ttlMs);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [text, ttlMs]);

  if (phase === "gone" || !text.trim()) return null;

  return (
    <p
      className={[
        "text-[11px] leading-snug text-muted/80 transition-opacity duration-500",
        phase === "out" ? "opacity-0" : "opacity-100",
        className
      ].join(" ")}
      role="status"
    >
      {text}
    </p>
  );
}
