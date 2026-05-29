import { hexToMp3DataUrl } from "./audioHex";
import { unusableInsecureHttpOnHttpsPage } from "./insecureHttpOnHttpsPage";

const batchInflight = new Map<string, Promise<Record<string, number>>>();
const probeInflight = new Map<string, Promise<number | null>>();

function normalizeJobIds(jobIds: string[]): string[] {
  return [...new Set(jobIds.map((x) => String(x || "").trim()).filter(Boolean))].sort();
}

/** 批量拉取作品 audio_duration_sec（BFF → 编排器，最多 50 id/次）。相同 id 集合并发只发一次。 */
export async function fetchJobsAudioDurationsBatch(
  jobIds: string[],
  headers: Record<string, string>
): Promise<Record<string, number>> {
  const ids = normalizeJobIds(jobIds).slice(0, 50);
  if (!ids.length) return {};

  const key = ids.join(",");
  const pending = batchInflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
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
    } finally {
      batchInflight.delete(key);
    }
  })();

  batchInflight.set(key, request);
  return request;
}

/** 单 job 回退：读 result 字段或 audio metadata；同 id 并发去重。 */
export async function probeJobAudioDurationSec(
  jobId: string,
  headers: Record<string, string>
): Promise<number | null> {
  const id = String(jobId || "").trim();
  if (!id) return null;

  const pending = probeInflight.get(id);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { ...headers }
      });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return null;

      const result = (row.result || {}) as Record<string, unknown>;
      const ds = result.audio_duration_sec;
      if (typeof ds === "number" && Number.isFinite(ds) && ds > 0) return ds;
      if (typeof ds === "string" && String(ds).trim()) {
        const n = Number.parseFloat(String(ds));
        if (Number.isFinite(n) && n > 0) return n;
      }

      const hex = String(result.audio_hex || "").trim();
      const audioUrl = String(result.audio_url || "").trim();
      if (!hex && !audioUrl) return null;
      if (!hex && audioUrl && unusableInsecureHttpOnHttpsPage(audioUrl)) return null;

      return await new Promise<number | null>((resolve) => {
        const a = document.createElement("audio");
        a.preload = "metadata";
        a.src = hex ? hexToMp3DataUrl(hex) : audioUrl;
        const done = (value: number | null) => {
          a.removeAttribute("src");
          a.load();
          resolve(value);
        };
        a.addEventListener("loadedmetadata", () => {
          done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
        });
        a.addEventListener("error", () => done(null));
      });
    } catch {
      return null;
    } finally {
      probeInflight.delete(id);
    }
  })();

  probeInflight.set(id, request);
  return request;
}
