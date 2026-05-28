import { useCallback, useEffect, useRef } from "react";
import { clearActiveGenerationJob, readActiveGenerationJob, setActiveGenerationJob } from "./activeJobSession";
import { jobEventsSourceUrl } from "./authHeaders";
import { isJobEventLogOnlyForUi } from "./jobEventStreamUi";
import { presentJobProgressMessageForUser } from "./jobProgressUserText";

type UsePodcastJobProgressTrackerOptions = {
  getAuthHeaders: () => Record<string, string>;
  onMessage: (message: string) => void;
  onBusy: (busy: boolean) => void;
  /** 任务进入终态后调用（成功或失败） */
  onTerminal?: (jobId: string, succeeded: boolean) => void;
  /** 挂载时若 session 中有未完成的播客任务则恢复监听 */
  recoverOnMount?: boolean;
};

/**
 * 笔记工作台等场景：创建播客任务后通过 SSE 更新进度文案，并在终态清理 session。
 */
export function usePodcastJobProgressTracker({
  getAuthHeaders,
  onMessage,
  onBusy,
  onTerminal,
  recoverOnMount = false
}: UsePodcastJobProgressTrackerOptions) {
  const onMessageRef = useRef(onMessage);
  const onBusyRef = useRef(onBusy);
  const onTerminalRef = useRef(onTerminal);
  const getAuthHeadersRef = useRef(getAuthHeaders);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const recoveryStartedRef = useRef(false);
  const trackingGenerationRef = useRef(0);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onBusyRef.current = onBusy;
    onTerminalRef.current = onTerminal;
    getAuthHeadersRef.current = getAuthHeaders;
  }, [onMessage, onBusy, onTerminal, getAuthHeaders]);

  const closeEventSource = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    activeJobIdRef.current = null;
  }, []);

  const applyProgressMessage = useCallback((message: string) => {
    const msg = presentJobProgressMessageForUser(message);
    if (msg) onMessageRef.current(msg);
  }, []);

  const finalizePodcastJob = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const terminal = (await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { ...getAuthHeadersRef.current() }
      }).then((r) => r.json())) as Record<string, unknown>;
      const status = String(terminal.status || "");
      const err = String(terminal.error_message || "");
      const succeeded = status === "succeeded";
      if (succeeded) applyProgressMessage("播客生成完成");
      else applyProgressMessage(err || "播客生成未成功");
      onTerminalRef.current?.(jobId, succeeded);
      return succeeded;
    } catch (e) {
      applyProgressMessage(String(e instanceof Error ? e.message : e));
      onTerminalRef.current?.(jobId, false);
      return false;
    }
  }, [applyProgressMessage]);

  const waitPodcastJobEvents = useCallback(
    (jobId: string, generation: number): Promise<void> =>
      new Promise<void>((resolve) => {
        closeEventSource();
        activeJobIdRef.current = jobId;
        const es = new EventSource(jobEventsSourceUrl(jobId, 0));
        eventSourceRef.current = es;
        es.onmessage = (evt) => {
          if (generation !== trackingGenerationRef.current) return;
          try {
            const data = JSON.parse(evt.data) as {
              type?: string;
              message?: string;
              status?: string;
              payload?: { progress?: number };
            };
            if (data.type === "terminal") {
              es.close();
              if (eventSourceRef.current === es) eventSourceRef.current = null;
              resolve();
              return;
            }
            if (isJobEventLogOnlyForUi(data.type)) return;
            const msg = String(data.message || "").trim();
            if (msg) applyProgressMessage(msg);
          } catch {
            // ignore malformed events
          }
        };
        es.onerror = () => {
          applyProgressMessage("连接中断，正在重试或结束…");
          es.close();
          if (eventSourceRef.current === es) eventSourceRef.current = null;
          resolve();
        };
      }),
    [applyProgressMessage, closeEventSource]
  );

  const startTracking = useCallback(
    (jobId: string) => {
      const id = jobId.trim();
      if (!id) return;
      const generation = trackingGenerationRef.current + 1;
      trackingGenerationRef.current = generation;
      setActiveGenerationJob("podcast", id);
      onBusyRef.current(true);
      applyProgressMessage("已提交，生成即将开始…");
      void (async () => {
        try {
          await waitPodcastJobEvents(id, generation);
          if (generation !== trackingGenerationRef.current) return;
          await finalizePodcastJob(id);
        } finally {
          if (generation !== trackingGenerationRef.current) return;
          clearActiveGenerationJob("podcast");
          closeEventSource();
          onBusyRef.current(false);
        }
      })();
    },
    [applyProgressMessage, closeEventSource, finalizePodcastJob, waitPodcastJobEvents]
  );

  useEffect(() => {
    if (!recoverOnMount) return;
    if (recoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("podcast");
    if (!sid) return;
    recoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${encodeURIComponent(sid)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeadersRef.current() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("podcast");
          if (st === "succeeded") applyProgressMessage("播客生成完成");
          else if (st === "failed") {
            applyProgressMessage(String(row.error_message || "播客生成未成功"));
          }
          onTerminalRef.current?.(sid, st === "succeeded");
          return;
        }
        if (st === "queued" || st === "running") {
          applyProgressMessage("检测到未完成的播客生成，继续监听…");
          startTracking(sid);
        }
      } catch {
        clearActiveGenerationJob("podcast");
      }
    })();
  }, [recoverOnMount, applyProgressMessage, startTracking]);

  useEffect(() => () => closeEventSource(), [closeEventSource]);

  return { startTracking };
}
