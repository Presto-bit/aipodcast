"use client";

import { useCallback, useEffect, useRef } from "react";

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: string }).name === "AbortError";
}

/** 页面级 AbortSignal：组件 unmount 时 abort，尽快结束 in-flight fetch。 */
export function usePageAbortSignal(): AbortSignal {
  const ctrlRef = useRef<AbortController | null>(null);
  if (ctrlRef.current === null) {
    ctrlRef.current = new AbortController();
  }

  useEffect(() => {
    const ctrl = ctrlRef.current;
    return () => {
      ctrl?.abort();
    };
  }, []);

  return ctrlRef.current.signal;
}

/** 绑定页面 AbortSignal 的 fetch；流式请求可传入独立 signal 覆盖。 */
export function usePageFetch(pageAbortSignal: AbortSignal) {
  return useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: init?.signal ?? pageAbortSignal }),
    [pageAbortSignal]
  );
}
