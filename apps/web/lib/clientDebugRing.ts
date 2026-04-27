/**
 * 浏览器端排障：环形缓冲 + 订阅，不含持久化。
 * 具体产品日志（window 键名、console 前缀、detail 裁剪策略）由各模块包装。
 */

export type ClientDebugRingListener<T> = (entry: T) => void;

export function createClientDebugRing<T>(capacity: number): {
  push: (entry: T) => void;
  subscribe: (fn: ClientDebugRingListener<T>) => () => void;
  snapshot: () => T[];
  liveRef: () => T[];
} {
  const buffer: T[] = [];
  const listeners = new Set<ClientDebugRingListener<T>>();

  function push(entry: T): void {
    buffer.push(entry);
    if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    for (const fn of listeners) {
      try {
        fn(entry);
      } catch {
        /* 避免面板回调影响主流程 */
      }
    }
  }

  function subscribe(fn: ClientDebugRingListener<T>): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  function snapshot(): T[] {
    return [...buffer];
  }

  /** 与内部环形数组同一引用，便于 `window.__x__` 在控制台随写入更新 */
  function liveRef(): T[] {
    return buffer;
  }

  return { push, subscribe, snapshot, liveRef };
}

export function truncateClientLogString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(truncated,len=${s.length})`;
}

/** 写入 sessionStorage / 环形缓冲前收敛长字符串与嵌套对象体积 */
export function sanitizeClientLogDetail(
  d: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!d || !Object.keys(d).length) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v == null) {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = truncateClientLogString(v, 2400);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 40);
    } else if (typeof v === "object") {
      try {
        out[k] = truncateClientLogString(JSON.stringify(v), 1200);
      } catch {
        out[k] = "[object]";
      }
    } else {
      out[k] = String(v);
    }
  }
  return out;
}
