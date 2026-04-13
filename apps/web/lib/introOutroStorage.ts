import type { IntroOutroSnapshotV1 } from "./introOutroSnapshot";
import { isIntroOutroSnapshotV1 } from "./introOutroSnapshot";

export type IntroOutroScope = "podcast" | "tts" | "notes_room";

export type IntroOutroNamedPreset = IntroOutroSnapshotV1 & {
  id: string;
  label: string;
  createdAt: number;
};

const MAX_NAMED = 24;

function lastKey(scope: IntroOutroScope) {
  return `fym_intro_outro_last_v1_${scope}`;
}

function namedKey(scope: IntroOutroScope) {
  return `fym_intro_outro_named_v1_${scope}`;
}

export function readLastIntroOutro(scope: IntroOutroScope): IntroOutroSnapshotV1 | null {
  try {
    const raw = localStorage.getItem(lastKey(scope));
    if (!raw) return null;
    const j = JSON.parse(raw) as unknown;
    return isIntroOutroSnapshotV1(j) ? j : null;
  } catch {
    return null;
  }
}

export function writeLastIntroOutro(scope: IntroOutroScope, snap: IntroOutroSnapshotV1) {
  try {
    localStorage.setItem(lastKey(scope), JSON.stringify(snap));
  } catch {
    // 配额已满等：静默失败
  }
}

function readNamedRaw(scope: IntroOutroScope): IntroOutroNamedPreset[] {
  try {
    const raw = localStorage.getItem(namedKey(scope));
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(isNamedPreset);
  } catch {
    return [];
  }
}

function isNamedPreset(x: unknown): x is IntroOutroNamedPreset {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.createdAt !== "number") return false;
  const { id: _i, label: _l, createdAt: _c, ...snap } = o;
  return isIntroOutroSnapshotV1(snap);
}

export function listIntroOutroNamed(scope: IntroOutroScope): IntroOutroNamedPreset[] {
  return readNamedRaw(scope).sort((a, b) => b.createdAt - a.createdAt);
}

export function addIntroOutroNamed(scope: IntroOutroScope, label: string, snap: IntroOutroSnapshotV1): IntroOutroNamedPreset {
  const trimmed = label.trim() || "未命名预设";
  const row: IntroOutroNamedPreset = {
    ...snap,
    id: `io_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    label: trimmed,
    createdAt: Date.now()
  };
  const items = [row, ...readNamedRaw(scope)].slice(0, MAX_NAMED);
  try {
    localStorage.setItem(namedKey(scope), JSON.stringify(items));
  } catch {
    // ignore
  }
  return row;
}

export function removeIntroOutroNamed(scope: IntroOutroScope, id: string): boolean {
  const prev = readNamedRaw(scope);
  const items = prev.filter((x) => x.id !== id);
  if (items.length === prev.length) return false;
  try {
    localStorage.setItem(namedKey(scope), JSON.stringify(items));
  } catch {
    return false;
  }
  return true;
}

export function importManyIntroOutroNamed(scope: IntroOutroScope, entries: { label: string; snapshot: IntroOutroSnapshotV1 }[]) {
  const prev = readNamedRaw(scope);
  const base = Date.now();
  const created = entries.map((e, i) => {
    const label = e.label.trim() || "导入预设";
    const row: IntroOutroNamedPreset = {
      ...e.snapshot,
      id: `io_${base.toString(36)}_${i}_${Math.random().toString(36).slice(2, 9)}`,
      label,
      createdAt: base + i
    };
    return row;
  });
  const merged = [...created, ...prev].slice(0, MAX_NAMED);
  try {
    localStorage.setItem(namedKey(scope), JSON.stringify(merged));
  } catch {
    // ignore
  }
}
