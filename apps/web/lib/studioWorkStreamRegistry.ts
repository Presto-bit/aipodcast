/** 按 workId 持有后台流式任务 UI 状态；切换会话不 abort */

import type { ManuscriptBlock } from "./studioWorkTypes";
import type { StudioAgentStep } from "./studioAgentSteps";

export type WorkStreamUiState = {
  streamingBlocks: ManuscriptBlock[] | null;
  streamingBodyText: string | null;
  streamOptimizing: boolean;
  agentRouteHint: string;
  agentSteps: StudioAgentStep[];
  jobBusy: boolean;
};

type StreamListener = (state: WorkStreamUiState) => void;

export type WorkStreamEntry = {
  abortController: AbortController;
  cancelMode: "stop" | "discard";
  activeStreamTurnId: string;
  streamingBlocksRef: ManuscriptBlock[] | null;
  streamingBodyRef: string | null;
  ui: WorkStreamUiState;
  listeners: Set<StreamListener>;
};

const EMPTY_UI: WorkStreamUiState = {
  streamingBlocks: null,
  streamingBodyText: null,
  streamOptimizing: false,
  agentRouteHint: "",
  agentSteps: [],
  jobBusy: false
};

const entries = new Map<string, WorkStreamEntry>();

function notify(entry: WorkStreamEntry) {
  const snapshot = { ...entry.ui };
  for (const fn of entry.listeners) fn(snapshot);
}

export function getWorkStreamState(workId: string): WorkStreamUiState | null {
  const entry = entries.get(workId);
  return entry ? { ...entry.ui } : null;
}

export function isWorkStreamRunning(workId: string): boolean {
  return entries.get(workId)?.ui.jobBusy ?? false;
}

export function subscribeWorkStream(workId: string, listener: StreamListener): () => void {
  const entry = entries.get(workId);
  if (entry) listener({ ...entry.ui });
  else listener({ ...EMPTY_UI });

  if (!entry) return () => {};

  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

export function registerWorkStream(
  workId: string,
  ac: AbortController,
  turnId: string
): WorkStreamEntry {
  const prev = entries.get(workId);
  prev?.abortController.abort();

  const entry: WorkStreamEntry = {
    abortController: ac,
    cancelMode: "stop",
    activeStreamTurnId: turnId,
    streamingBlocksRef: null,
    streamingBodyRef: null,
    ui: {
      ...EMPTY_UI,
      jobBusy: true
    },
    listeners: prev?.listeners ?? new Set()
  };
  entries.set(workId, entry);
  notify(entry);
  return entry;
}

export function getWorkStreamEntry(workId: string): WorkStreamEntry | undefined {
  return entries.get(workId);
}

export function patchWorkStreamUi(workId: string, patch: Partial<WorkStreamUiState>): void {
  const entry = entries.get(workId);
  if (!entry) return;
  entry.ui = { ...entry.ui, ...patch };
  notify(entry);
}

export function patchWorkStreamRefs(
  workId: string,
  refs: { streamingBlocksRef?: ManuscriptBlock[] | null; streamingBodyRef?: string | null }
): void {
  const entry = entries.get(workId);
  if (!entry) return;
  if (refs.streamingBlocksRef !== undefined) entry.streamingBlocksRef = refs.streamingBlocksRef;
  if (refs.streamingBodyRef !== undefined) entry.streamingBodyRef = refs.streamingBodyRef;
}

export function abortWorkStream(workId: string, mode: "stop" | "discard"): void {
  const entry = entries.get(workId);
  if (!entry) return;
  entry.cancelMode = mode;
  entry.abortController.abort();
}

export function clearWorkStream(workId: string, ac: AbortController): void {
  const entry = entries.get(workId);
  if (!entry || entry.abortController !== ac) return;
  entry.ui = { ...EMPTY_UI };
  entry.streamingBlocksRef = null;
  entry.streamingBodyRef = null;
  notify(entry);
  entries.delete(workId);
}

export function workStreamAbortMatches(workId: string, ac: AbortController): boolean {
  return entries.get(workId)?.abortController === ac;
}

export function workStreamCancelMode(workId: string): "stop" | "discard" {
  return entries.get(workId)?.cancelMode ?? "stop";
}
