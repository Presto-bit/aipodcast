"use client";

import { useEffect, useState, type ReactNode } from "react";

/** 任务结束后保留数秒再淡出（Agent 步骤条等） */
export default function StudioEphemeralPanel({
  children,
  active,
  ttlMs = 4000,
  className = ""
}: {
  children: ReactNode;
  active: boolean;
  ttlMs?: number;
  className?: string;
}) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("gone");

  useEffect(() => {
    if (active) {
      setPhase("in");
      return;
    }
    setPhase((prev) => (prev === "gone" ? "gone" : "in"));
    const fade = window.setTimeout(() => setPhase("out"), Math.max(600, ttlMs - 500));
    const gone = window.setTimeout(() => setPhase("gone"), ttlMs);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(gone);
    };
  }, [active, ttlMs]);

  if (phase === "gone") return null;

  return (
    <div
      className={[
        "transition-opacity duration-500",
        phase === "out" ? "opacity-0" : "opacity-100",
        className
      ].join(" ")}
    >
      {children}
    </div>
  );
}
