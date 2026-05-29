/** 批量拉取作品 audio_duration_sec（BFF → 编排器，最多 50 id/次）。 */
export async function fetchJobsAudioDurationsBatch(
  jobIds: string[],
  headers: Record<string, string>
): Promise<Record<string, number>> {
  const ids = jobIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 50);
  if (!ids.length) return {};
  const res = await fetch("/api/jobs/audio-durations", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ job_ids: ids })
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    durations?: Record<string, number>;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.detail || `加载时长失败 ${res.status}`);
  }
  const out: Record<string, number> = {};
  const raw = data.durations;
  if (raw && typeof raw === "object") {
    for (const [id, sec] of Object.entries(raw)) {
      if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) out[id] = sec;
    }
  }
  return out;
}
