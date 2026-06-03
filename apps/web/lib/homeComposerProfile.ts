import { patchAuthorIp, type AuthorIpItem } from "./authorIp";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";
import {
  normalizePersonalProfile,
  PERSONAL_SUPPLEMENT_FIELDS,
  personalSupplementPromptLabel
} from "./homeComposerPersonalFields";

export function personalProfileFromAuthorIp(item: AuthorIpItem | null): HomeComposerPersonalProfile | null {
  if (!item?.profile || typeof item.profile !== "object") return null;
  return normalizePersonalProfile(item.profile);
}

export function personalProfileToPrompt(profile: HomeComposerPersonalProfile): string {
  return PERSONAL_SUPPLEMENT_FIELDS.map(({ key }) => {
    const val = profile[key].trim();
    return val ? `${personalSupplementPromptLabel(key)}：${val}` : "";
  })
    .filter(Boolean)
    .join("\n");
}

export function personalProfileToApiProfile(profile: HomeComposerPersonalProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of PERSONAL_SUPPLEMENT_FIELDS) {
    const val = profile[key].trim();
    if (val) out[key] = val.slice(0, 1200);
  }
  return out;
}

export async function fetchDefaultAuthorIp(): Promise<AuthorIpItem | null> {
  const res = await fetch("/api/author-ips/default", {
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { detail?: string }).detail || "加载个人特色失败"));
  }
  return (data as { item?: AuthorIpItem | null }).item ?? null;
}

export async function saveDefaultAuthorIpProfile(
  ipId: string,
  profile: HomeComposerPersonalProfile
): Promise<AuthorIpItem> {
  return patchAuthorIp(ipId, { profile: personalProfileToApiProfile(profile) });
}
