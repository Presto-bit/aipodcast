"use client";

import { useRef, useState } from "react";
import { rememberJobId } from "../../lib/jobRecent";
import { messageLooksLikeWalletTopupHint } from "../../lib/billingShortfall";
import { useAuth } from "../../lib/auth";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";

/** 本地录音上传上限（与后端上限一致，避免长音频被拒） */
const MAX_RECORD_BYTES = 20 * 1024 * 1024;
/** 上传文件克隆：与界面说明一致 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const DIALOGUE_HELP = [
  "在安静环境录制，避免回声与背景噪声。",
  "建议连续朗读 15～60 秒，口齿清晰、音量稳定。",
  "克隆将使用MINIMAX服务，遵守MiniMax服务协议。"
];

const UPLOAD_HELP = [
  "支持 wav / mp3 / m4a 等，单文件最大2MB。",
  "音频需包含足够有效人声，避免回声与背景噪声。"
];

const card =
  "rounded-2xl border border-line bg-surface p-4 shadow-soft";

export default function VoiceClonePanel() {
  const { getAuthHeaders } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function blobToBase64(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function runClone(blob: Blob, filename: string, maxBytes: number, limitLabel: string) {
    if (blob.size > maxBytes) {
      setError(`文件过大，最大 ${limitLabel}`);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const audioB64 = await blobToBase64(blob);
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          project_name: "web-voice-native",
          job_type: "voice_clone",
          queue_name: "ai",
          payload: {
            filename,
            audio_b64: audioB64
          }
        })
      });
      const created = (await createRes.json().catch(() => ({}))) as { id?: string };
      if (!createRes.ok || !created.id) {
        throw new Error(`任务创建失败 ${createRes.status}`);
      }
      const jobId = String(created.id);
      rememberJobId(jobId);
      let terminal: Record<string, unknown> | null = null;
      for (let i = 0; i < 90; i++) {
        const rr = await fetch(`/api/jobs/${jobId}`, { cache: "no-store", headers: { ...getAuthHeaders() } });
        const row = (await rr.json().catch(() => ({}))) as Record<string, unknown>;
        if (!rr.ok) throw new Error(`任务读取失败 ${rr.status}`);
        if (["succeeded", "failed", "cancelled"].includes(String(row.status || ""))) {
          terminal = row;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!terminal) throw new Error("任务超时未结束");
      if (String(terminal.status) !== "succeeded") {
        throw new Error(String(terminal.error_message || "音色克隆失败"));
      }
      setResult((terminal.result || {}) as Record<string, unknown>);
      try {
        window.dispatchEvent(new Event("fym-saved-voices-changed"));
      } catch {
        // ignore
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function startRecord() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(200);
      setRecording(true);
    } catch (e) {
      setError(`无法访问麦克风：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function stopRecordAndClone() {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") {
      setRecording(false);
      return;
    }
    await new Promise<void>((resolve) => {
      mr.addEventListener("stop", () => resolve(), { once: true });
      mr.stop();
    });
    const stream = streamRef.current;
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setRecording(false);
    const first = chunksRef.current[0];
    const mime = first instanceof Blob ? first.type : "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    if (!blob.size) {
      setError("未录制到有效音频");
      return;
    }
    const ext = blob.type.includes("webm") ? "webm" : "wav";
    await runClone(blob, `record_${Date.now()}.${ext}`, MAX_RECORD_BYTES, "20MB");
  }

  return (
    <div>
      <div className="mt-0 grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className="text-sm font-semibold text-ink">对话克隆</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted">
            {DIALOGUE_HELP.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            {!recording ? (
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void startRecord()}
              >
                开始录音
              </button>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-danger px-3 py-2 text-sm text-onStrong disabled:opacity-50"
                disabled={busy}
                onClick={() => void stopRecordAndClone()}
              >
                停止并克隆
              </button>
            )}
          </div>
          {recording ? <p className="mt-2 text-xs text-warning-ink">录音中…</p> : null}
        </section>

        <section className={card}>
          <h2 className="text-sm font-semibold text-ink">上传文件克隆</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted">
            {UPLOAD_HELP.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.aac,.webm,.mp4"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void runClone(f, f.name || "upload.wav", MAX_UPLOAD_BYTES, "2MB");
            }}
          />
          <button
            type="button"
            className="mt-4 rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "处理中..." : "选择音频文件"}
          </button>
        </section>
      </div>

      {error ? (
        <div className="mt-6 text-sm text-danger-ink">
          <p>{error}</p>
          {messageLooksLikeWalletTopupHint(error) ? <BillingShortfallLinks className="mt-2" /> : null}
        </div>
      ) : null}

      {result ? (
        <section className={`mt-6 ${card}`}>
          <h2 className="text-sm font-medium text-ink">结果</h2>
          <p className="mt-2 text-sm text-success-ink">
            voice_id: {String(result.voice_id || "-")}
            {result.display_name ? ` · ${String(result.display_name)}` : ""}
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs text-ink">{JSON.stringify(result, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}
