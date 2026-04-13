/**
 * 用户自定义内容模板；登录后将随用户偏好同步服务端。
 */
import { scheduleCloudPreferencesPush } from "./cloudPreferences";
import type { PodcastStudioPreset } from "./podcastStudioPresets";

const KEY = "fym_user_templates_v1";

export type UserTemplate = PodcastStudioPreset & {
  category: string;
  createdAt: number;
};

function readRaw(): UserTemplate[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? (j as UserTemplate[]) : [];
  } catch {
    return [];
  }
}

function saveRaw(items: UserTemplate[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  scheduleCloudPreferencesPush();
}

export function listUserTemplates(): UserTemplate[] {
  return readRaw().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function categoriesFromTemplates(items: UserTemplate[]): string[] {
  const s = new Set<string>();
  for (const t of items) {
    const c = (t.category || "未分类").trim() || "未分类";
    s.add(c);
  }
  return Array.from(s).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function addUserTemplate(t: Omit<UserTemplate, "createdAt"> & { createdAt?: number }): UserTemplate {
  const items = readRaw();
  const row: UserTemplate = {
    ...t,
    category: (t.category || "未分类").trim() || "未分类",
    createdAt: t.createdAt ?? Date.now()
  };
  items.unshift(row);
  saveRaw(items.slice(0, 80));
  return row;
}

export function updateUserTemplate(id: string, patch: Partial<Omit<UserTemplate, "createdAt">>): boolean {
  const items = readRaw();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return false;
  items[i] = { ...items[i], ...patch, id: items[i].id, createdAt: items[i].createdAt };
  saveRaw(items);
  return true;
}

export function removeUserTemplate(id: string): boolean {
  const prev = readRaw();
  const items = prev.filter((x) => x.id !== id);
  if (items.length === prev.length) return false;
  saveRaw(items);
  return true;
}

export function mergePresetOptions(
  builtIn: PodcastStudioPreset[],
  user: UserTemplate[]
): { value: string; label: string; group: string; prefix: string }[] {
  const out: { value: string; label: string; group: string; prefix: string }[] = [];
  for (const p of builtIn) {
    out.push({ value: `sys:${p.id}`, label: p.label, group: "内置", prefix: p.textPrefix });
  }
  for (const p of user) {
    out.push({
      value: `usr:${p.id}`,
      label: p.label,
      group: p.category || "我的",
      prefix: p.textPrefix
    });
  }
  return out;
}
