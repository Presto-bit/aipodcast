import type { ReactNode } from "react";
import ShellProviders from "../ShellProviders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return <ShellProviders variant="server">{children}</ShellProviders>;
}
