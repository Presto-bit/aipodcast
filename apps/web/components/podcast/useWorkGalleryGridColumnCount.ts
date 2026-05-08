"use client";

import { useEffect, useState } from "react";

/** 与 PodcastWorksGallery 非侧栏网格 Tailwind 断点一致：sm / lg / xl */
export function useWorkGalleryGridColumnCount(): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const q = () => {
      const w = window.innerWidth;
      if (w >= 1280) setCols(4);
      else if (w >= 1024) setCols(3);
      else if (w >= 640) setCols(2);
      else setCols(1);
    };
    q();
    window.addEventListener("resize", q);
    return () => window.removeEventListener("resize", q);
  }, []);
  return cols;
}
