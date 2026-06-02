"use client";

import { useState } from "react";

type Props = {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
};

/** 营销静态 WebP：直链 public，shimmer 占位至 onLoad，避免 Next 优化管道延迟。 */
export default function MarketingStaticImage({
  src,
  alt,
  width,
  height,
  priority = false,
  className = ""
}: Props) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${width} / ${height}` }}>
      {!loaded ? (
        <div
          className="absolute inset-0 animate-pulse rounded-2xl bg-gradient-to-br from-fill via-fill/70 to-fill/40"
          aria-hidden
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "low"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={[
          "h-auto w-full transition-opacity duration-300 motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
          className
        ].join(" ")}
      />
    </div>
  );
}
