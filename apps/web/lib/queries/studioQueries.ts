"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { WorkItem } from "../worksTypes";

export type StudioBootstrapPack = {
  defaultVoices?: Record<string, Record<string, unknown>>;
  systemVoices?: Record<string, Record<string, unknown>>;
  savedVoices?: { voiceId: string; displayName?: string }[];
  notes?: { noteId: string; title?: string; notebook?: string }[];
  notebooks?: string[];
};

async function fetchStudioBootstrap(headers: Record<string, string>): Promise<StudioBootstrapPack> {
  const r = await fetch("/api/studio-bootstrap", {
    cache: "no-store",
    credentials: "same-origin",
    headers
  });
  const pack = (await r.json().catch(() => ({}))) as {
    defaultVoices?: { ok: boolean; data: unknown };
    savedVoices?: { ok: boolean; data: unknown };
    notes?: { ok: boolean; data: unknown };
    notebooks?: { ok: boolean; data: unknown };
  };
  const dd = (pack.defaultVoices?.data ?? {}) as {
    voices?: Record<string, Record<string, unknown>>;
    system_voices?: Record<string, Record<string, unknown>>;
  };
  const sd = (pack.savedVoices?.data ?? {}) as { voices?: { voiceId: string; displayName?: string }[] };
  const nd = (pack.notes?.data ?? {}) as {
    success?: boolean;
    notes?: { noteId: string; title?: string; notebook?: string }[];
  };
  const nbd = (pack.notebooks?.data ?? {}) as { success?: boolean; notebooks?: string[] };
  return {
    defaultVoices: dd.voices,
    systemVoices: dd.system_voices,
    savedVoices: Array.isArray(sd.voices) ? sd.voices : undefined,
    notes: pack.notes?.ok && nd.success && Array.isArray(nd.notes) ? nd.notes.slice(0, 300) : undefined,
    notebooks: pack.notebooks?.ok && nbd.success && Array.isArray(nbd.notebooks) ? nbd.notebooks : undefined
  };
}

async function fetchPodcastWorks(headers: Record<string, string>): Promise<WorkItem[]> {
  const res = await fetch("/api/works", { cache: "no-store", headers });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    ai?: WorkItem[];
    error?: string;
    detail?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
  }
  return Array.isArray(data.ai) ? data.ai : [];
}

export function useStudioBootstrap(getAuthHeaders: () => Record<string, string>, loggedIn: boolean) {
  return useQuery({
    queryKey: ["studio-bootstrap"],
    queryFn: () => fetchStudioBootstrap(getAuthHeaders()),
    enabled: loggedIn,
    staleTime: 60_000
  });
}

export function usePodcastWorksQuery(getAuthHeaders: () => Record<string, string>, loggedIn: boolean) {
  return useQuery({
    queryKey: ["podcast-works-ai"],
    queryFn: () => fetchPodcastWorks(getAuthHeaders()),
    enabled: loggedIn,
    staleTime: 30_000
  });
}

/** 音色保存事件：使 studio-bootstrap 与 saved_voices 缓存失效 */
export function useInvalidateStudioVoicesOnEvent(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onChange = () => {
      void queryClient.invalidateQueries({ queryKey: ["studio-bootstrap"] });
    };
    window.addEventListener("fym-saved-voices-changed", onChange);
    return () => window.removeEventListener("fym-saved-voices-changed", onChange);
  }, [enabled, queryClient]);
}
