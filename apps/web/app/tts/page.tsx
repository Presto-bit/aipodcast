"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PodcastWorksGallery from "../../components/podcast/PodcastWorksGallery";
import { chipClass } from "../../components/studio/chipStyles";
import { PlayIcon, StopIcon } from "../../components/studio/MediaIcons";
import { VoiceSelect, type VoiceOpt } from "../../components/studio/VoiceSelect";
import BgmControlRow from "../../components/studio/BgmControlRow";
import IntroOutroPresetBar from "../../components/studio/IntroOutroPresetBar";
import { jobEventsSourceUrl } from "../../lib/authHeaders";
import { cancelJob } from "../../lib/api";
import { rememberJobId } from "../../lib/jobRecent";
import { clearActiveGenerationJob, readActiveGenerationJob, setActiveGenerationJob } from "../../lib/activeJobSession";
import { PODCAST_PRESET_VOICES } from "../../lib/podcastVoiceDefaults";
import { buildVoiceOptionsFromMaps, resolveVoiceId } from "../../lib/podcastStudioCommon";
import { readSpeakerDefaultVoiceKeys } from "../../lib/presetVoicesStorage";
import { TTS_IMPORT_SCRIPT_KEY } from "../../lib/ttsImport";
import { bgmSegmentPayloadFromState, type BgmUiMode } from "../../lib/bgmUpload";
import { buildIntroOutroSnapshot, type IntroOutroSnapshotV1 } from "../../lib/introOutroSnapshot";
import { readLastIntroOutro, writeLastIntroOutro } from "../../lib/introOutroStorage";
import type { WorkItem } from "../../lib/worksTypes";
import FloatingPopover from "../../components/ui/FloatingPopover";
import { useAuth } from "../../lib/auth";

type PanelId = "mode" | "voice" | "intro" | null;

const MAIN_PLACEHOLDER =
  "在此输入要转成语音的正文。单人模式直接粘贴文本；双人模式请用「Speaker1:」「Speaker2:」分行写对白。";
const TTS_REUSE_TEMPLATE_KEY = "fym_reuse_template_tts_v1";

export default function TtsPage() {
  const { getAuthHeaders } = useAuth();
  const [defaultVoicesMap, setDefaultVoicesMap] = useState<Record<string, Record<string, unknown>>>({});
  const [savedCustomVoices, setSavedCustomVoices] = useState<{ voiceId: string; displayName?: string }[]>([]);
  const [voiceKey1, setVoiceKey1] = useState("mini");
  const [voiceKey2, setVoiceKey2] = useState("max");
  const [ttsMode, setTtsMode] = useState<"single" | "dual">("single");
  const [text, setText] = useState("");
  const [introText, setIntroText] = useState("");
  const [outroText, setOutroText] = useState("");
  const [introVoiceFollow, setIntroVoiceFollow] = useState(true);
  const [introVoiceKey, setIntroVoiceKey] = useState("mini");
  const [outroVoiceFollow, setOutroVoiceFollow] = useState(true);
  const [outroVoiceKey, setOutroVoiceKey] = useState("mini");
  const [introBgm1Mode, setIntroBgm1Mode] = useState<BgmUiMode>("none");
  const [introBgm2Mode, setIntroBgm2Mode] = useState<BgmUiMode>("none");
  const [outroBgm3Mode, setOutroBgm3Mode] = useState<BgmUiMode>("none");
  const [introBgm1File, setIntroBgm1File] = useState<File | null>(null);
  const [introBgm2File, setIntroBgm2File] = useState<File | null>(null);
  const [outroBgm3File, setOutroBgm3File] = useState<File | null>(null);
  const [introBgm1StoredHex, setIntroBgm1StoredHex] = useState<string | null>(null);
  const [introBgm2StoredHex, setIntroBgm2StoredHex] = useState<string | null>(null);
  const [outroBgm3StoredHex, setOutroBgm3StoredHex] = useState<string | null>(null);
  const [introOutroHydrated, setIntroOutroHydrated] = useState(false);
  const [generateCover, setGenerateCover] = useState(true);
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [lastRawTextBeforePolish, setLastRawTextBeforePolish] = useState("");
  const [taskPhase, setTaskPhase] = useState("");
  const [taskProgressPct, setTaskProgressPct] = useState(0);
  /** 默认不展开「开头结尾」；与 AI 播客同一套面板 */
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [worksLoading, setWorksLoading] = useState(true);
  const [worksError, setWorksError] = useState("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const resolveWaitRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  const logSuccessHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryStartedRef = useRef(false);

  const stopPanelPointer = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const applyIntroOutroSnapshot = useCallback((s: IntroOutroSnapshotV1) => {
    setIntroText(s.introText);
    setOutroText(s.outroText);
    setIntroVoiceFollow(s.introVoiceFollow);
    setIntroVoiceKey(s.introVoiceKey);
    setOutroVoiceFollow(s.outroVoiceFollow);
    setOutroVoiceKey(s.outroVoiceKey);
    setIntroBgm1Mode(s.introBgm1Mode);
    setIntroBgm2Mode(s.introBgm2Mode);
    setOutroBgm3Mode(s.outroBgm3Mode);
    setIntroBgm1File(null);
    setIntroBgm2File(null);
    setOutroBgm3File(null);
    setIntroBgm1StoredHex(s.introBgm1Hex ?? null);
    setIntroBgm2StoredHex(s.introBgm2Hex ?? null);
    setOutroBgm3StoredHex(s.outroBgm3Hex ?? null);
  }, []);

  const buildIntroOutroSnapshotNow = useCallback(
    () =>
      buildIntroOutroSnapshot({
        introText,
        outroText,
        introVoiceFollow,
        introVoiceKey,
        outroVoiceFollow,
        outroVoiceKey,
        introBgm1Mode,
        introBgm2Mode,
        outroBgm3Mode,
        introBgm1File,
        introBgm2File,
        outroBgm3File,
        introBgm1StoredHex,
        introBgm2StoredHex,
        outroBgm3StoredHex
      }),
    [
      introText,
      outroText,
      introVoiceFollow,
      introVoiceKey,
      outroVoiceFollow,
      outroVoiceKey,
      introBgm1Mode,
      introBgm2Mode,
      outroBgm3Mode,
      introBgm1File,
      introBgm2File,
      outroBgm3File,
      introBgm1StoredHex,
      introBgm2StoredHex,
      outroBgm3StoredHex
    ]
  );

  const mergedDefaultVoices = useMemo((): Record<string, Record<string, unknown>> => {
    const out: Record<string, Record<string, unknown>> = { ...PODCAST_PRESET_VOICES };
    for (const [k, v] of Object.entries(defaultVoicesMap)) {
      if (!v || typeof v !== "object") continue;
      const base = (out[k] || {}) as Record<string, unknown>;
      const incoming = v as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base, ...incoming };
      const rawVid = String(incoming.voice_id ?? incoming.voiceId ?? "").trim();
      if ((k === "mini" || k === "max") && rawVid.startsWith("male-qn-")) {
        const want = String(PODCAST_PRESET_VOICES[k]?.voice_id ?? "").trim();
        if (want.startsWith("moss_audio_")) merged.voice_id = want;
      } else if (!merged.voice_id && typeof incoming.voiceId === "string" && incoming.voiceId.trim()) {
        merged.voice_id = incoming.voiceId.trim();
      }
      out[k] = merged;
    }
    return out;
  }, [defaultVoicesMap]);

  const voiceOptions = useMemo(
    () => buildVoiceOptionsFromMaps(mergedDefaultVoices, savedCustomVoices),
    [mergedDefaultVoices, savedCustomVoices]
  );

  const voiceId1 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey1), [voiceOptions, voiceKey1]);
  const voiceId2 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey2), [voiceOptions, voiceKey2]);

  const voiceSummary =
    ttsMode === "single"
      ? voiceOptions.find((v) => v.key === voiceKey1)?.name ?? "音色"
      : `${voiceOptions.find((v) => v.key === voiceKey1)?.name ?? "1"}·${voiceOptions.find((v) => v.key === voiceKey2)?.name ?? "2"}`;
  const introSummary =
    introText.trim() ||
    outroText.trim() ||
    introBgm1Mode !== "none" ||
    introBgm2Mode !== "none" ||
    outroBgm3Mode !== "none" ||
    !introVoiceFollow ||
    !outroVoiceFollow
      ? "已设"
      : "未选";

  const fetchTtsWorks = useCallback(async () => {
    setWorksError("");
    try {
      const res = await fetch("/api/works", { cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        tts?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
      setWorks(Array.isArray(data.tts) ? data.tts : []);
    } catch (e) {
      setWorksError(String(e instanceof Error ? e.message : e));
      setWorks([]);
    } finally {
      setWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void fetchTtsWorks();
  }, [fetchTtsWorks]);

  useEffect(() => {
    void (async () => {
      try {
        const [d, s] = await Promise.all([
          fetch("/api/default-voices", { cache: "no-store", headers: { ...getAuthHeaders() } }),
          fetch("/api/saved_voices", { cache: "no-store", headers: { ...getAuthHeaders() } })
        ]);
        const dd = (await d.json().catch(() => ({}))) as { voices?: Record<string, Record<string, unknown>> };
        const sd = (await s.json().catch(() => ({}))) as { voices?: { voiceId: string; displayName?: string }[] };
        if (dd.voices) setDefaultVoicesMap(dd.voices);
        if (Array.isArray(sd.voices)) setSavedCustomVoices(sd.voices);
      } catch {
        // ignore
      }
    })();
  }, [getAuthHeaders]);

  useEffect(() => {
    const sp = readSpeakerDefaultVoiceKeys();
    setVoiceKey1(sp.speaker1);
    setVoiceKey2(sp.speaker2);
  }, []);

  useEffect(() => {
    try {
      const imp = sessionStorage.getItem(TTS_IMPORT_SCRIPT_KEY);
      if (imp) {
        setText(imp);
        sessionStorage.removeItem(TTS_IMPORT_SCRIPT_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TTS_REUSE_TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        text?: string;
        tts_mode?: string;
        intro_text?: string;
        outro_text?: string;
      };
      const txt = String(parsed.text || "").trim();
      if (txt) setText(txt);
      const mode = String(parsed.tts_mode || "single").trim();
      setTtsMode(mode === "dual" ? "dual" : "single");
      setIntroText(String(parsed.intro_text || "").trim());
      setOutroText(String(parsed.outro_text || "").trim());
      sessionStorage.removeItem(TTS_REUSE_TEMPLATE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const last = readLastIntroOutro("tts");
    if (last) applyIntroOutroSnapshot(last);
    setIntroOutroHydrated(true);
  }, [applyIntroOutroSnapshot]);

  useEffect(() => {
    if (!introOutroHydrated) return;
    const timer = window.setTimeout(() => {
      void buildIntroOutroSnapshotNow().then((snap) => writeLastIntroOutro("tts", snap));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [introOutroHydrated, buildIntroOutroSnapshotNow]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-tts-panel]") || t.closest("[data-floating-panel]")) return;
      if (t.closest("[data-tts-toolbar-chip]")) return;
      if (t.closest("[data-tts-toolbar-gen]")) return;
      setActivePanel(null);
    }
    if (activePanel) {
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
    }
  }, [activePanel]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePanel(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (logSuccessHideTimerRef.current) clearTimeout(logSuccessHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (recoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("tts");
    if (!sid) return;
    recoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<
          string,
          unknown
        >;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("tts");
          void fetchTtsWorks();
          return;
        }
        if (st === "queued" || st === "running") {
          cancelledRef.current = false;
          setBusy(true);
          setTaskProgressPct(5);
          applyTaskFromEvent("检测到未完成的生成，继续监听…", 5);
          rememberJobId(sid);
          activeJobIdRef.current = sid;
          await waitJobEvents(sid);
          if (!cancelledRef.current) await finalizeJob(sid);
        }
      } catch {
        clearActiveGenerationJob("tts");
      } finally {
        clearActiveGenerationJob("tts");
        setBusy(false);
        cancelledRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时尝试恢复
  }, [getAuthHeaders]);

  function applyTaskFromEvent(message: string, progressFromPayload?: number) {
    setTaskPhase(message);
    if (typeof progressFromPayload === "number" && !Number.isNaN(progressFromPayload)) {
      setTaskProgressPct(Math.min(100, Math.max(0, progressFromPayload)));
    }
  }

  function waitJobEvents(jobId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      resolveWaitRef.current = resolve;
      const es = new EventSource(jobEventsSourceUrl(jobId, 0));
      eventSourceRef.current = es;
      activeJobIdRef.current = jobId;
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            status?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") {
            es.close();
            eventSourceRef.current = null;
            resolveWaitRef.current = null;
            resolve();
            return;
          }
          const msg = String(data.message || "").trim();
          const p = data.payload?.progress;
          if (msg) applyTaskFromEvent(msg, typeof p === "number" ? p : undefined);
          else if (typeof p === "number") setTaskProgressPct(Math.min(100, Math.max(0, p)));
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        applyTaskFromEvent("连接中断，正在重试或结束…");
        es.close();
        eventSourceRef.current = null;
        resolveWaitRef.current = null;
        resolve();
      };
    });
  }

  async function finalizeJob(jobId: string): Promise<boolean> {
    try {
      const terminal = (await fetch(`/api/jobs/${jobId}`, {
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      }).then((r) => r.json())) as Record<
        string,
        unknown
      >;
      const status = String(terminal.status || "");
      const err = String(terminal.error_message || "");
      const succeeded = status === "succeeded";
      if (succeeded) applyTaskFromEvent("合成完成", 100);
      else applyTaskFromEvent(err || "生成未成功");
      void fetchTtsWorks();
      return succeeded;
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      applyTaskFromEvent(msg);
      void fetchTtsWorks();
      return false;
    }
  }

  async function stopGeneration() {
    if (logSuccessHideTimerRef.current) {
      clearTimeout(logSuccessHideTimerRef.current);
      logSuccessHideTimerRef.current = null;
    }
    const jobId = activeJobIdRef.current;
    cancelledRef.current = true;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    resolveWaitRef.current?.();
    resolveWaitRef.current = null;
    activeJobIdRef.current = null;
    if (jobId) {
      try {
        await cancelJob(jobId);
        applyTaskFromEvent("已发送取消请求");
        await finalizeJob(jobId);
      } catch (e) {
        applyTaskFromEvent(`取消: ${String(e)}`);
      }
    }
    clearActiveGenerationJob("tts");
    setBusy(false);
  }

  async function runTts() {
    let body = text.trim();
    if (!body && !introText.trim() && !outroText.trim()) {
      applyTaskFromEvent("请输入文本，或填写开场/结尾");
      return;
    }
    if (!voiceId1 || (ttsMode === "dual" && !voiceId2)) {
      applyTaskFromEvent("正在加载音色列表，请稍后再试");
      return;
    }
    cancelledRef.current = false;
    if (logSuccessHideTimerRef.current) {
      clearTimeout(logSuccessHideTimerRef.current);
      logSuccessHideTimerRef.current = null;
    }

    setBusy(true);
    setTaskProgressPct(0);
    try {
      if (ttsMode === "dual") {
        const hasLine = /^\s*Speaker\s*[12]\s*[:：]/im.test(body);
        if (!hasLine) {
          applyTaskFromEvent("双人模式请使用 Speaker1: / Speaker2: 分行标注对白");
          return;
        }
      }

      applyTaskFromEvent("正在为你排队…", 2);
      const b1 = await bgmSegmentPayloadFromState(introBgm1Mode, introBgm1File, introBgm1StoredHex);
      const b2 = await bgmSegmentPayloadFromState(introBgm2Mode, introBgm2File, introBgm2StoredHex);
      const b3 = await bgmSegmentPayloadFromState(outroBgm3Mode, outroBgm3File, outroBgm3StoredHex);
      const ttsExtras: Record<string, unknown> = {};
      if (b1.slot) ttsExtras.intro_bgm1_slot = b1.slot;
      if (b1.mp3_hex) ttsExtras.intro_bgm1_mp3_hex = b1.mp3_hex;
      if (b2.slot) ttsExtras.intro_bgm2_slot = b2.slot;
      if (b2.mp3_hex) ttsExtras.intro_bgm2_mp3_hex = b2.mp3_hex;
      if (b3.slot) ttsExtras.outro_bgm3_slot = b3.slot;
      if (b3.mp3_hex) ttsExtras.outro_bgm3_mp3_hex = b3.mp3_hex;
      if (!introVoiceFollow) ttsExtras.intro_voice_id = resolveVoiceId(voiceOptions, introVoiceKey);
      if (!outroVoiceFollow) ttsExtras.outro_voice_id = resolveVoiceId(voiceOptions, outroVoiceKey);

      const payload: Record<string, unknown> = {
        text: body || " ",
        tts_mode: ttsMode,
        intro_text: introText.trim(),
        outro_text: outroText.trim(),
        generate_cover: generateCover,
        ...ttsExtras
      };
      if (ttsMode === "single") {
        payload.voice_id = voiceId1;
      } else {
        payload.voice_id_1 = voiceId1;
        payload.voice_id_2 = voiceId2;
      }
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          project_name: "web-tts-native",
          job_type: "text_to_speech",
          queue_name: "ai",
          payload
        })
      });
      if (!createRes.ok) {
        applyTaskFromEvent(`创建失败: HTTP ${createRes.status}`);
        return;
      }
      const created = (await createRes.json().catch(() => ({}))) as { id?: string };
      const jobId = String(created.id || "").trim();
      if (!jobId) {
        applyTaskFromEvent("创建失败: 缺少记录编号");
        return;
      }
      applyTaskFromEvent("已提交，生成即将开始…", 5);
      rememberJobId(jobId);
      setActiveGenerationJob("tts", jobId);
      setActivePanel(null);

      await waitJobEvents(jobId);
      if (!cancelledRef.current) {
        const ok = await finalizeJob(jobId);
        if (ok && !cancelledRef.current) {
          if (logSuccessHideTimerRef.current) clearTimeout(logSuccessHideTimerRef.current);
          logSuccessHideTimerRef.current = setTimeout(() => {
            setTaskPhase("");
            setTaskProgressPct(0);
            logSuccessHideTimerRef.current = null;
          }, 5000);
        }
      }
    } catch (err) {
      applyTaskFromEvent(`错误: ${String(err)}`);
    } finally {
      clearActiveGenerationJob("tts");
      if (!cancelledRef.current) setBusy(false);
      cancelledRef.current = false;
    }
  }

  function normalizePolishedText(raw: string, mode: "single" | "dual"): string {
    let out = raw.replace(/\r\n?/g, "\n").trim();
    const fenced = out.match(/^```(?:text|markdown)?\s*\n([\s\S]*?)\n```$/i);
    if (fenced?.[1]) out = fenced[1].trim();
    if (mode === "dual") {
      out = out
        .split("\n")
        .map((line) =>
          line
            .replace(/^\s*speaker\s*1\s*[:：]\s*/i, "Speaker1: ")
            .replace(/^\s*speaker\s*2\s*[:：]\s*/i, "Speaker2: ")
        )
        .join("\n")
        .replace(/^\s*(speaker[12])\s+(?!:)/gim, "$1: ");
    }
    return out;
  }

  async function runAiPolish() {
    const source = text.trim();
    if (!source) {
      applyTaskFromEvent("请先输入要润色的正文");
      return;
    }
    if (busy) {
      applyTaskFromEvent("正在合成中，请先停止后再润色");
      return;
    }
    setPolishing(true);
    applyTaskFromEvent("AI 润色中…", 8);
    try {
      const res = await fetch("/api/tts_polish", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ text: source, tts_mode: ttsMode })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; text?: string; detail?: string; error?: string };
      if (!res.ok || !data.success) {
        const msg = String(data.detail || data.error || `HTTP ${res.status}`);
        applyTaskFromEvent(`润色失败: ${msg}`);
        return;
      }
      const polished = normalizePolishedText(String(data.text || ""), ttsMode);
      if (!polished) {
        applyTaskFromEvent("润色完成，但返回为空");
        return;
      }
      setLastRawTextBeforePolish(text);
      setText(polished);
      applyTaskFromEvent("润色完成，可直接合成", 100);
    } catch (err) {
      applyTaskFromEvent(`润色失败: ${String(err)}`);
    } finally {
      setPolishing(false);
    }
  }

  const showTaskPanel = busy || taskPhase.length > 0;
  const etaMinutesRemaining = useMemo(() => {
    if (!busy && taskProgressPct >= 100) return 0;
    const charEst = Math.max(320, text.length + introText.length + outroText.length);
    const totalMin = Math.max(3, Math.min(36, Math.round(3 + charEst / 950)));
    if (taskProgressPct <= 0) return totalMin;
    return Math.max(1, Math.ceil(((100 - taskProgressPct) / 100) * totalMin));
  }, [busy, taskProgressPct, text.length, introText.length, outroText.length]);

  const panelClassAnchor =
    "z-[360] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-white p-2.5 shadow-lg sm:p-3";
  const panelClassIntroAnchor =
    "z-[360] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-white p-3 shadow-lg sm:p-4";
  const panelClassAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-white p-2.5 shadow-lg sm:p-3 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(52dvh,300px)]";
  const panelClassIntroAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-white p-3 shadow-lg sm:p-4 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(68dvh,520px)]";
  const renderFloatingPanel = useCallback(
    (panelId: Exclude<PanelId, null>, mobileClass: string, desktopClass: string, ariaLabel: string, children: ReactNode) => {
      if (activePanel !== panelId) return null;
      const anchorEl =
        typeof document === "undefined"
          ? null
          : (() => {
              const node = document.querySelector(`[data-tts-toolbar-chip-id="${panelId}"]`);
              return node instanceof HTMLElement ? node : null;
            })();
      return (
        <FloatingPopover
          open={activePanel === panelId}
          anchorEl={anchorEl}
          isMobile={isMobileViewport}
          mobileClassName={mobileClass}
          desktopClassName={desktopClass}
          ariaLabel={ariaLabel}
          onMouseDown={stopPanelPointer}
        >
          {children}
        </FloatingPopover>
      );
    },
    [activePanel, isMobileViewport, stopPanelPointer]
  );

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">文本转语音</h1>
        <p className="mt-2 text-sm text-muted">
          灵感不该沉默。从文字到人声，开启属于你的声音自媒体时代
        </p>
      </div>

      <section className="relative overflow-visible rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex min-h-0 flex-col p-4 md:p-5">
          <textarea
            className="min-h-[min(22vh,140px)] w-full max-w-none resize-y rounded-xl border border-line bg-fill p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 md:min-h-[150px]"
            placeholder={MAIN_PLACEHOLDER}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="relative mt-4 border-t border-line pt-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <span data-tts-toolbar-chip data-tts-toolbar-chip-id="mode" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "mode")} onClick={() => setActivePanel((p) => (p === "mode" ? null : "mode"))}>
                      {ttsMode === "dual" ? "双人" : "单人"}
                    </button>
                    {renderFloatingPanel(
                      "mode",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "单人或双人",
                      <>
                        <p className="mb-3 text-sm font-medium text-ink">单人 / 双人</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`rounded-lg px-4 py-2 text-sm ${ttsMode === "single" ? "bg-brand text-white" : "border border-line"}`}
                            onClick={() => setTtsMode("single")}
                          >
                            单人
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-4 py-2 text-sm ${ttsMode === "dual" ? "bg-brand text-white" : "border border-line"}`}
                            onClick={() => setTtsMode("dual")}
                          >
                            双人
                          </button>
                        </div>
                        {ttsMode === "dual" ? (
                          <p className="mt-3 text-xs text-amber-800">
                            每行以 <code className="rounded bg-fill px-1">Speaker1:</code> 或{" "}
                            <code className="rounded bg-fill px-1">Speaker2:</code> 开头。
                          </p>
                        ) : null}
                      </>
                    )}
                  </span>
                  <span data-tts-toolbar-chip data-tts-toolbar-chip-id="voice" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "voice")} onClick={() => setActivePanel((p) => (p === "voice" ? null : "voice"))}>
                      音色 · {voiceSummary}
                    </button>
                    {renderFloatingPanel(
                      "voice",
                      panelClassAnchorMobile,
                      panelClassAnchor,
                      "音色",
                      <>
                        <p className="mb-1 text-sm font-medium">音色</p>
                        <p className="mb-3 text-xs text-muted">克隆音色优先列出。</p>
                        {voiceOptions.length === 0 ? (
                          <p className="text-xs text-amber-700">正在加载音色列表…</p>
                        ) : null}
                        {ttsMode === "single" ? (
                          <label className="block text-xs">
                            主音色
                            <VoiceSelect voiceOptions={voiceOptions} value={voiceKey1} onChange={setVoiceKey1} />
                          </label>
                        ) : (
                          <div className="space-y-2">
                            <label className="block text-xs">
                              Speaker1
                              <VoiceSelect voiceOptions={voiceOptions} value={voiceKey1} onChange={setVoiceKey1} />
                            </label>
                            <label className="block text-xs">
                              Speaker2
                              <VoiceSelect voiceOptions={voiceOptions} value={voiceKey2} onChange={setVoiceKey2} />
                            </label>
                          </div>
                        )}
                      </>
                    )}
                  </span>
                  <span data-tts-toolbar-chip data-tts-toolbar-chip-id="intro" className="relative inline-block align-top">
                    <button type="button" className={chipClass(activePanel === "intro")} onClick={() => setActivePanel((p) => (p === "intro" ? null : "intro"))}>
                      开头结尾 · {introSummary}
                    </button>
                    {renderFloatingPanel(
                      "intro",
                      panelClassIntroAnchorMobile,
                      panelClassIntroAnchor,
                      "开场与结尾",
                      <>
                        <p className="mb-1 text-sm font-medium">开场 / 结尾</p>
                        <p className="mb-3 text-xs text-muted">
                          与 AI 播客相同：背景音1 → 开场语 → 背景音2 → 正文 → 结尾语 → 背景音3（均为可选）。
                        </p>
                        <IntroOutroPresetBar
                          scope="tts"
                          buildSnapshot={buildIntroOutroSnapshotNow}
                          onApplySnapshot={applyIntroOutroSnapshot}
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-xl border border-line bg-fill/80 p-4">
                            <h3 className="mb-3 text-sm font-semibold text-ink">开场设置</h3>
                            <BgmControlRow
                              label="背景音 1"
                              mode={introBgm1Mode}
                              onModeChange={(m) => {
                                setIntroBgm1Mode(m);
                                if (m !== "upload") setIntroBgm1StoredHex(null);
                              }}
                              file={introBgm1File}
                              onFileChange={(f) => {
                                setIntroBgm1File(f);
                                if (f) setIntroBgm1StoredHex(null);
                              }}
                              uploadRestoredHint={introBgm1Mode === "upload" && Boolean(introBgm1StoredHex && !introBgm1File)}
                            />
                            <label className="mt-3 block text-xs">
                              开场语
                              <textarea
                                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-white p-2 text-sm"
                                rows={3}
                                value={introText}
                                onChange={(e) => setIntroText(e.target.value)}
                                placeholder="例如：欢迎收听本期节目（留空可跳过）"
                              />
                            </label>
                            <div className="mt-3 space-y-2">
                              <span className="text-xs font-medium text-ink">音色</span>
                              <select
                                className="w-full rounded-lg border border-line bg-white p-2 text-sm"
                                value={introVoiceFollow ? "follow" : "custom"}
                                onChange={(e) => setIntroVoiceFollow(e.target.value === "follow")}
                              >
                                <option value="follow">默认跟随正文主音色 / Speaker1</option>
                                <option value="custom">自定义</option>
                              </select>
                              {!introVoiceFollow ? <VoiceSelect voiceOptions={voiceOptions} value={introVoiceKey} onChange={setIntroVoiceKey} /> : null}
                            </div>
                            <div className="mt-3">
                              <BgmControlRow
                                label="背景音 2"
                                mode={introBgm2Mode}
                                onModeChange={(m) => {
                                  setIntroBgm2Mode(m);
                                  if (m !== "upload") setIntroBgm2StoredHex(null);
                                }}
                                file={introBgm2File}
                                onFileChange={(f) => {
                                  setIntroBgm2File(f);
                                  if (f) setIntroBgm2StoredHex(null);
                                }}
                                uploadRestoredHint={introBgm2Mode === "upload" && Boolean(introBgm2StoredHex && !introBgm2File)}
                              />
                            </div>
                          </div>
                          <div className="rounded-xl border border-line bg-fill/80 p-4">
                            <h3 className="mb-3 text-sm font-semibold text-ink">结尾设置</h3>
                            <label className="block text-xs">
                              结尾语
                              <textarea
                                className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-white p-2 text-sm"
                                rows={3}
                                value={outroText}
                                onChange={(e) => setOutroText(e.target.value)}
                                placeholder="例如：感谢收听，我们下期再见（留空可跳过）"
                              />
                            </label>
                            <div className="mt-3 space-y-2">
                              <span className="text-xs font-medium text-ink">音色</span>
                              <select
                                className="w-full rounded-lg border border-line bg-white p-2 text-sm"
                                value={outroVoiceFollow ? "follow" : "custom"}
                                onChange={(e) => setOutroVoiceFollow(e.target.value === "follow")}
                              >
                                <option value="follow">默认跟随正文主音色 / Speaker1</option>
                                <option value="custom">自定义</option>
                              </select>
                              {!outroVoiceFollow ? <VoiceSelect voiceOptions={voiceOptions} value={outroVoiceKey} onChange={setOutroVoiceKey} /> : null}
                            </div>
                            <div className="mt-3">
                              <BgmControlRow
                                label="背景音 3"
                                mode={outroBgm3Mode}
                                onModeChange={(m) => {
                                  setOutroBgm3Mode(m);
                                  if (m !== "upload") setOutroBgm3StoredHex(null);
                                }}
                                file={outroBgm3File}
                                onFileChange={(f) => {
                                  setOutroBgm3File(f);
                                  if (f) setOutroBgm3StoredHex(null);
                                }}
                                uploadRestoredHint={outroBgm3Mode === "upload" && Boolean(outroBgm3StoredHex && !outroBgm3File)}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </span>
                  <span data-tts-toolbar-chip className="relative inline-block align-top">
                    <button
                      type="button"
                      className={chipClass(polishing)}
                      onClick={() => {
                        void runAiPolish();
                      }}
                      disabled={polishing || busy}
                      title="将正文润色为更适合朗读的口语风格"
                    >
                      {polishing ? "润色中…" : "AI润色"}
                    </button>
                  </span>
                  <span data-tts-toolbar-chip className="relative inline-block align-top">
                    <button
                      type="button"
                      className={chipClass(false)}
                      onClick={() => {
                        if (!lastRawTextBeforePolish) return;
                        setText(lastRawTextBeforePolish);
                        setLastRawTextBeforePolish("");
                        applyTaskFromEvent("已撤销到润色前文本");
                      }}
                      disabled={!lastRawTextBeforePolish || polishing || busy}
                      title="撤销最近一次 AI 润色结果"
                    >
                      撤销润色
                    </button>
                  </span>
                  <span data-tts-toolbar-chip className="relative inline-block align-top">
                    <button
                      type="button"
                      className={chipClass(generateCover)}
                      aria-pressed={generateCover}
                      onClick={() => setGenerateCover((v) => !v)}
                    >
                      生成封面
                    </button>
                  </span>
                </div>
              </div>

              <button
                type="button"
                data-tts-toolbar-gen
                onClick={() => {
                  if (busy) {
                    void stopGeneration();
                    return;
                  }
                  void runTts();
                }}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-full bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-500 sm:ml-1 sm:self-start"
                aria-label={busy ? "停止合成" : "开始合成"}
              >
                {busy ? <StopIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-4 w-4 translate-x-px" />}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">我的作品</h2>
        {showTaskPanel ? (
          <div className="mb-4 rounded-2xl border border-brand/25 bg-fill/90 p-4 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">生成进度</h3>
            <p className="mt-2 text-sm text-ink">{taskPhase || (busy ? "处理中…" : "—")}</p>
            {busy || taskProgressPct > 0 ? (
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                阶段含：排队 → 语音合成（含开场/结尾）→ 可选封面；长文会稍久。
              </p>
            ) : null}
            <div className="mt-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-track/90">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, taskProgressPct))}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{taskProgressPct > 0 ? `${taskProgressPct}%` : busy ? "排队中" : ""}</span>
                <span>
                  {busy || taskProgressPct > 0
                    ? taskProgressPct >= 100
                      ? "已完成"
                      : `预估剩余约 ${etaMinutesRemaining} 分钟`
                    : ""}
                </span>
              </div>
            </div>
          </div>
        ) : null}
        <PodcastWorksGallery
          variant="tts"
          works={works}
          loading={worksLoading}
          fetchError={worksError}
          onDismissError={() => setWorksError("")}
          onWorkDeleted={() => void fetchTtsWorks()}
        />
      </section>
    </main>
  );
}
