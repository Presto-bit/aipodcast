import { readSessionStorageScoped, removeSessionStorageScoped, writeSessionStorageScoped } from "./userScopedStorage";

const K_PODCAST = "fym_active_podcast_job_v1";
const K_TTS = "fym_active_tts_job_v1";
const K_SCRIPT_DRAFT = "fym_active_script_draft_job_v1";
const K_SOCIAL_PUBLISH = "fym_active_social_publish_job_v1";

export type ActiveGenerationKind = "podcast" | "tts" | "script_draft" | "social_publish";

function keyFor(kind: ActiveGenerationKind): string {
  if (kind === "podcast") return K_PODCAST;
  if (kind === "tts") return K_TTS;
  if (kind === "social_publish") return K_SOCIAL_PUBLISH;
  return K_SCRIPT_DRAFT;
}

export function setActiveGenerationJob(kind: ActiveGenerationKind, jobId: string) {
  try {
    writeSessionStorageScoped(keyFor(kind), jobId);
  } catch {
    // ignore
  }
}

export function clearActiveGenerationJob(kind: ActiveGenerationKind) {
  try {
    removeSessionStorageScoped(keyFor(kind));
  } catch {
    // ignore
  }
}

export function readActiveGenerationJob(kind: ActiveGenerationKind): string | null {
  try {
    return readSessionStorageScoped(keyFor(kind));
  } catch {
    return null;
  }
}
