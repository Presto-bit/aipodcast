/** 在浏览器空闲时执行；无 rIC 时用短 timeout 兜底。 */
export function runWhenIdle(task: () => void, timeoutMs = 2500): () => void {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(task, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const timer = window.setTimeout(task, 150);
  return () => window.clearTimeout(timer);
}
