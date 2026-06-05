export type StudioAgentStepStatus = "pending" | "running" | "done" | "error";

export type StudioAgentStep = {
  id: string;
  label: string;
  status: StudioAgentStepStatus;
  tool?: string;
};

export function upsertAgentStep(steps: StudioAgentStep[], next: StudioAgentStep): StudioAgentStep[] {
  const idx = steps.findIndex((s) => s.id === next.id);
  if (idx >= 0) {
    const copy = steps.slice();
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...steps, next];
}

export function parseStudioAgentStep(ev: Record<string, unknown>): StudioAgentStep | null {
  const id = String(ev.id || "").trim();
  const label = String(ev.label || "").trim();
  const status = String(ev.status || "").trim();
  if (!id || !label) return null;
  if (status !== "pending" && status !== "running" && status !== "done" && status !== "error") {
    return null;
  }
  const tool = String(ev.tool || "").trim();
  return { id, label, status, tool: tool || undefined };
}
