"use client";

import { useEffect } from "react";
import { requestAppSidebarCollapse } from "../../../lib/appSidebarCollapse";

export default function ShownotesLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    requestAppSidebarCollapse();
  }, []);
  return children;
}
