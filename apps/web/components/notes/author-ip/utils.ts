import type { AuthorIpItem } from "../../../lib/authorIp";

export type TraitRow = {
  dimension?: string;
  label?: string;
  evidence?: string;
  defaultOn?: boolean;
  confidence?: number;
};

export function traitsFromItem(item: AuthorIpItem | null): TraitRow[] {
  const prof = item?.profile as { traits?: TraitRow[] } | undefined;
  return Array.isArray(prof?.traits) ? prof.traits : [];
}
