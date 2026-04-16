"use client";

import { useCallback, useRef, useState } from "react";
import { rememberJobId } from "../../lib/jobRecent";
import { messageLooksLikeWalletTopupHint } from "../../lib/billingShortfall";
import { useAuth } from "../../lib/auth";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";

/** 本地录音上传上限（与后端上限一致，避免长音频被拒） */
const MAX_RECORD_BYTES = 20 * 1024 * 1024;
/** 上传文件克隆：与界面说明一致 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const DIALOGUE_HELP = [
  "点击「开始录音」后先阅读试读卡片（约半分钟口播量），再正式开录。",
  "在安静环境录制，避免回声与背景噪声；口齿清晰、音量稳定。",
  "克隆将使用MINIMAX服务，遵守MiniMax服务协议。"
];

/** 试读稿：语速适中约 25～35 秒，覆盖不同音素与声调 */
const CLONE_READING_PASSAGES: string[] = [
  "清晨的城市还没完全醒来，交通广播里已经在讨论昨夜发布的新款芯片。有人说性能翻倍，也有人担心功耗和供货。其实对我们大多数人来说，真正重要的不是参数表上的数字，而是这些变化会怎样悄悄改变我们手里的设备、常用的软件，以及未来几年的工作方式。我们不妨把问题拆成三个层次：它解决了什么旧痛点？带来了什么新选择？又有哪些风险需要我们提前留意？想清楚这三点，比记住任何一句营销口号都更有用。",
  "周末在咖啡馆里，邻桌两位朋友争论人工智能会不会取代创意工作。一位举了自动配乐的例子，另一位则坚持认为审美和叙事仍需要人的温度。我想，技术从来不是非黑即白的答案，更像一把新工具：有人用它偷懒，也有人用它把重复劳动交给机器，从而把时间留给真正需要判断与同理心的环节。关键在于，我们是否愿意持续学习、不断校准自己的角色，而不是被动等待结果砸到头上。",
  "海洋监测卫星传回的数据，让科学家第一次如此清晰地看到某片海域温度的细微波动。图表上的曲线看似冰冷，背后却是无数工程师在地面站轮流值守、校准传感器、修补算法漏洞。科技新闻常常只写「成功发射」四个大字，却很少描述那些失败重试的夜晚。当我们把聚光灯也分给这些细节，公众对创新的理解会更踏实，对风险的讨论也会更具体，而不是停留在口号和焦虑之间摇摆。",
  "社区医院新上线的挂号系统，本意是缩短排队时间，却在上线第一周让不少老年人手足无措。产品团队很快组织了志愿者手把手教学，并把关键按钮放大、加上语音提示。这个小小的插曲提醒我们：再先进的技术，如果忽略了真实使用场景里的人群分布，就很难称得上成功。好的设计，应当同时考虑效率与包容，让数字便利真正落在每一个人身上，而不是把一部分人悄悄留在门外。",
  "考古队在干旱河谷里发现了一处古代灌溉遗迹，石槽上的磨损痕迹诉说着千年前人们如何与自然谈判。今天，我们用水泵和传感器做类似的事，只是工具换了材质。历史与科技并不是两条平行线，它们都在回答人类如何更聪明地利用资源、又如何为后代留下余地。把这样的故事讲给听众听，或许能让我们在追逐最新发布的同时，也多一份耐心与敬畏。"
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
  const [readCardOpen, setReadCardOpen] = useState(false);
  const [readPassageIndex, setReadPassageIndex] = useState(0);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const pickRandomPassageIndex = useCallback((avoid?: number) => {
    if (CLONE_READING_PASSAGES.length <= 1) return 0;
    let next = Math.floor(Math.random() * CLONE_READING_PASSAGES.length);
    let guard = 0;
    while (next === avoid && guard < 8) {
      next = Math.floor(Math.random() * CLONE_READING_PASSAGES.length);
      guard += 1;
    }
    return next;
  }, []);

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

  function openReadingCard() {
    setError("");
    setReadPassageIndex(pickRandomPassageIndex());
    setReadCardOpen(true);
  }

  function refreshReadingPassage() {
    setReadPassageIndex((i) => pickRandomPassageIndex(i));
  }

  async function startMicCapture() {
    setError("");
    setReadCardOpen(false);
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
      setReadCardOpen(false);
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
    setReadCardOpen(false);
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
          {readCardOpen && !recording ? (
            <div className="mt-4 rounded-xl border border-brand/25 bg-brand/[0.04] p-3 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2">
                <p className="text-xs font-semibold text-ink">试读稿（约半分钟）</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-muted hover:border-brand/35 hover:text-ink"
                    onClick={refreshReadingPassage}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 9a8 8 0 0113.657-5.657M20 15a8 8 0 01-13.657 5.657M20 15v-4M4 9v4"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    换一段
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-line px-2 py-1 text-[11px] text-muted hover:bg-fill"
                    onClick={() => setReadCardOpen(false)}
                  >
                    返回
                  </button>
                </div>
              </div>
              <p className="mt-2 max-h-40 overflow-y-auto text-sm leading-relaxed text-ink">
                {CLONE_READING_PASSAGES[readPassageIndex] ?? CLONE_READING_PASSAGES[0]}
              </p>
              <button
                type="button"
                className="mt-3 w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void startMicCapture()}
              >
                开始朗读并录音
              </button>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {!recording && !readCardOpen ? (
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-50"
                disabled={busy}
                onClick={openReadingCard}
              >
                开始录音
              </button>
            ) : null}
            {recording ? (
              <button
                type="button"
                className="rounded-lg bg-danger px-3 py-2 text-sm text-onStrong disabled:opacity-50"
                disabled={busy}
                onClick={() => void stopRecordAndClone()}
              >
                停止并克隆
              </button>
            ) : null}
          </div>
          {recording ? <p className="mt-2 text-xs text-warning-ink">录音中…请朗读试读稿或相近内容，保持自然语速。</p> : null}
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
