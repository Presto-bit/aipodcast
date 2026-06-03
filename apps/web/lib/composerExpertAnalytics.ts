/** 首页 Composer 专家模式埋点 v0（localStorage，供内测与后续上报对接） */

const STORAGE_KEY = "fym_composer_expert_events_v1";
const MAX_EVENTS = 500;

export type ComposerExpertEventName =
  | "expert_selected"
  | "confirm_start"
  | "copy"
  | "tab"
  | "feedback";

export type ComposerExpertEvent = {
  name: ComposerExpertEventName;
  ts: number;
  props: Record<string, string | number | boolean | undefined>;
};

function readEvents(): ComposerExpertEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ComposerExpertEvent[]) : [];
  } catch {
    return [];
  }
}

function writeEvents(events: ComposerExpertEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // quota or private mode — ignore
  }
}

export function trackComposerExpertEvent(
  name: ComposerExpertEventName,
  props: Record<string, string | number | boolean | undefined> = {}
): void {
  const event: ComposerExpertEvent = { name, ts: Date.now(), props };
  writeEvents([...readEvents(), event]);
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console -- 内测埋点调试
    console.debug("[composer-expert]", name, props);
  }
}

export function getComposerExpertEvents(): ComposerExpertEvent[] {
  return readEvents();
}
