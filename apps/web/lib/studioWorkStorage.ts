import type { FeatureCore } from "./homeComposerExpertTypes";
import { EMPTY_FEATURE_CORE } from "./homeComposerFeatureCore";
import { activeHomeComposerSession, loadHomeComposerStore } from "./homeComposerChatStorage";
import { readStudioWorksBlob, writeStudioWorksBlob } from "./studioWorkCloud";
import type { StudioWork, WorkStatus } from "./studioWorkTypes";

function inheritFromComposerPrefs(): Pick<StudioWork, "featureCore" | "binding"> {
  const store = loadHomeComposerStore();
  const session = activeHomeComposerSession(store);
  const prefs = session?.prefs;
  return {
    featureCore: prefs?.featureCore ? { ...prefs.featureCore } : { ...EMPTY_FEATURE_CORE },
    binding: {
      notebook: prefs?.notebook?.trim() || "",
      noteIds: Array.isArray(prefs?.noteIds) ? [...prefs.noteIds] : []
    }
  };
}

function loadAll(): StudioWork[] {
  if (typeof window === "undefined") return [];
  return readStudioWorksBlob();
}

function saveAll(works: StudioWork[]): void {
  if (typeof window === "undefined") return;
  writeStudioWorksBlob(works);
}

export function listStudioWorks(): StudioWork[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getStudioWork(id: string): StudioWork | null {
  return loadAll().find((w) => w.id === id) ?? null;
}

export function upsertStudioWork(work: StudioWork): StudioWork {
  const all = loadAll();
  const idx = all.findIndex((w) => w.id === work.id);
  const next = { ...work, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  saveAll(all);
  return next;
}

export function deleteStudioWork(id: string): void {
  saveAll(loadAll().filter((w) => w.id !== id));
}

export function createStudioWork(params?: {
  brief?: string;
  featureCore?: FeatureCore;
}): StudioWork {
  const id = crypto.randomUUID();
  const brief = (params?.brief || "").trim();
  const inherited = inheritFromComposerPrefs();
  const work: StudioWork = {
    id,
    channel: "xhs",
    title: brief.slice(0, 40) || "新小红书任务",
    brief,
    status: brief ? "briefing" : "briefing",
    binding: inherited.binding,
    featureCore: params?.featureCore ?? inherited.featureCore,
    allowModelFallback: false,
    intake: {},
    versions: [],
    activeVersionId: "",
    shipChecks: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return upsertStudioWork(work);
}

export function patchStudioWork(id: string, patch: Partial<StudioWork>): StudioWork | null {
  const cur = getStudioWork(id);
  if (!cur) return null;
  return upsertStudioWork({ ...cur, ...patch, id: cur.id });
}

export function setWorkStatus(id: string, status: WorkStatus): StudioWork | null {
  return patchStudioWork(id, { status });
}
