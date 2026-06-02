import { patchAuthorIp, type AuthorIpItem } from "./authorIp";
import type { HomeComposerPersonalProfile } from "./homeComposerTypes";

const PERSONAL_FIELD_LABELS: { key: keyof HomeComposerPersonalProfile; label: string }[] = [
  { key: "identity", label: "身份/职业" },
  { key: "currentDoing", label: "目前在做什么" },
  { key: "pastExperience", label: "过去的重要经历" },
  { key: "difficulties", label: "关键困难/低谷/失败" },
  { key: "choices", label: "做过的重要选择" },
  { key: "results", label: "拿到的结果/成绩/反馈" },
  { key: "remember", label: "最想让别人记住的点" },
  { key: "values", label: "想传递的价值观" },
  { key: "other", label: "其他" }
];

export function personalProfileFromAuthorIp(item: AuthorIpItem | null): HomeComposerPersonalProfile | null {
  if (!item?.profile || typeof item.profile !== "object") return null;
  const p = item.profile as Record<string, unknown>;
  const read = (key: string) => String(p[key] ?? "").trim();
  const mapped: HomeComposerPersonalProfile = {
    identity: read("identity"),
    currentDoing: read("currentDoing"),
    pastExperience: read("pastExperience"),
    difficulties: read("difficulties"),
    choices: read("choices"),
    results: read("results"),
    remember: read("remember"),
    values: read("values"),
    other: read("other")
  };
  const hasAny = Object.values(mapped).some(Boolean);
  return hasAny ? mapped : null;
}

export function personalProfileToPrompt(profile: HomeComposerPersonalProfile): string {
  return PERSONAL_FIELD_LABELS.map(({ key, label }) => {
    const val = profile[key].trim();
    return val ? `${label}：${val}` : "";
  })
    .filter(Boolean)
    .join("\n");
}

export function personalProfileToApiProfile(profile: HomeComposerPersonalProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of PERSONAL_FIELD_LABELS) {
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
