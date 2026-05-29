"use client";

import type { ReactNode } from "react";
import { useActiveJobsQuery } from "../lib/queries/activeJobsQuery";

/** 全站单一 active jobs 轮询源；子组件通过 useActiveJobsQuery 读缓存。 */
export default function ActiveJobsProvider({
  children,
  enabled
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  useActiveJobsQuery(enabled);
  return <>{children}</>;
}
