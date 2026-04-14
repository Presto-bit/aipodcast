"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction
} from "react";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import {
  DEFAULT_CREATIVE_TEMPLATE_VALUE,
  formatCreativeTemplateChip,
  resolveCreativeBundle
} from "../../lib/creativeTemplates";
import { buildReferenceJobFields } from "../../lib/jobReferencePayload";
import { rememberJobId } from "../../lib/jobRecent";
import { setActiveGenerationJob } from "../../lib/activeJobSession";
import CreativeTemplatePicker from "../studio/CreativeTemplatePicker";
import IntroOutroPresetBar from "../studio/IntroOutroPresetBar";
import { chipClass } from "../studio/chipStyles";
import { PlayIcon } from "../studio/MediaIcons";
import { VoiceSelect } from "../studio/VoiceSelect";
import BgmControlRow from "../studio/BgmControlRow";
import { bgmSegmentPayloadFromState, type BgmUiMode } from "../../lib/bgmUpload";
import { buildIntroOutroSnapshot, type IntroOutroSnapshotV1 } from "../../lib/introOutroSnapshot";
import { readLastIntroOutro, writeLastIntroOutro } from "../../lib/introOutroStorage";
import { PODCAST_PRESET_VOICES } from "../../lib/podcastVoiceDefaults";
import {
  buildScriptPayload,
  buildVoiceOptionsFromMaps,
  DEFAULT_PROGRAM_NAME,
  durationInputMatchesCommitted,
  resolveScriptTargetCharsForJob,
  DURATION_PRESETS,
  LANG_OPTIONS,
  resolveVoiceId
} from "../../lib/podcastStudioCommon";
import { formatOrchestratorErrorText, previewMediaJob } from "../../lib/api";
import { useAuth, userAccountRef } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import { planIsBasicOrAbove } from "../../lib/noteReferenceLimits";
import { LockedToolbarChipPill } from "../SubscriptionVipLink";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { PODCAST_ROOM_PRESETS, type PodcastRoomPresetKey } from "../../lib/notesRoomPresets";
import FloatingPopover from "../ui/FloatingPopover";
import {
  CREATIVE_CHIP_HOVER_HINT
} from "../../lib/studioHoverHints";

type PanelId = "mode" | "lang" | "voice" | "duration" | "intro" | "creative" | null;

const MAIN_TEXT_PLACEHOLDER = "可补充要点；将结合已选笔记生成。";

export type NotesPodcastRoomModalProps = {
  open: boolean;
  onClose: () => void;
  notebookName: string;
  /** 笔记本内已勾选的笔记 ID（锁定参与 RAG） */
  lockedNoteIds: string[];
  /** 当前套餐下最多可选笔记数（与服务端一致） */
  maxLockedNotes?: number;
  noteTitleById: Record<string, string>;
  presetKey: PodcastRoomPresetKey;
  /** 创建 podcast_generate 任务成功后交给父级监听进度 */
  onPodcastJobCreated: (jobId: string) => void;
  /** 嵌入创作页：无遮罩，仅占位块 */
  layout?: "modal" | "inline";
  /** 由父级提供正文（与顶部统一输入框联动） */
  externalPrompt?: string;
  onExternalPromptChange?: (value: string) => void;
  /** 主按钮改由父级左侧触发 */
  hideGenerateButton?: boolean;
  /** 成功后是否关闭（内联布局通常为 false） */
  closeOnSuccess?: boolean;
  /** 内联布局：同步忙碌状态给父级（左侧操作区） */
  onBusyChange?: (busy: boolean) => void;
};

export type NotesPodcastRoomModalHandle = {
  generate: () => void;
};

const NotesPodcastRoomModal = forwardRef<NotesPodcastRoomModalHandle, NotesPodcastRoomModalProps>(
  function NotesPodcastRoomModal(
    {
      open,
      onClose,
      notebookName,
      lockedNoteIds,
      noteTitleById,
      maxLockedNotes = 10,
      presetKey,
      onPodcastJobCreated,
      layout = "modal",
      externalPrompt: controlledPrompt,
      onExternalPromptChange,
      hideGenerateButton = false,
      closeOnSuccess = true,
      onBusyChange
    },
    ref
  ) {
  const { user, phone, getAuthHeaders } = useAuth();
  const { t } = useI18n();
  const createdByPhone = userAccountRef(user) || String(phone || "").trim();
  const planBasicOk = useMemo(() => planIsBasicOrAbove(String(user?.plan)), [user?.plan]);

  const [internalPrompt, setInternalPrompt] = useState("");
  /** 媒体钱包预检 / 创建任务失败时的提示（替换不可点链接的 alert） */
  const [billingGateMessage, setBillingGateMessage] = useState<string | null>(null);
  const text = controlledPrompt !== undefined ? controlledPrompt : internalPrompt;
  const setText = useCallback(
    (next: SetStateAction<string>) => {
      if (controlledPrompt !== undefined) {
        const v = typeof next === "function" ? (next as (p: string) => string)(controlledPrompt) : next;
        onExternalPromptChange?.(v);
      } else {
        setInternalPrompt(next);
      }
    },
    [controlledPrompt, onExternalPromptChange]
  );
  const [scriptTargetChars, setScriptTargetChars] = useState(800);
  const [scriptTargetCharsInput, setScriptTargetCharsInput] = useState("800");
  const [creativeTemplateValue, setCreativeTemplateValue] = useState(DEFAULT_CREATIVE_TEMPLATE_VALUE);
  const [scriptLanguage, setScriptLanguage] = useState("中文");
  const creativeBundle = useMemo(() => resolveCreativeBundle(creativeTemplateValue), [creativeTemplateValue]);
  const [generateCover] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (open) setBillingGateMessage(null);
  }, [open]);

  const [speakerMode, setSpeakerMode] = useState<"single" | "dual">("dual");
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
  const [defaultVoicesMap, setDefaultVoicesMap] = useState<Record<string, Record<string, unknown>>>({});
  const [systemVoicesMap, setSystemVoicesMap] = useState<Record<string, Record<string, unknown>>>({});
  const [savedCustomVoices, setSavedCustomVoices] = useState<{ voiceId: string; displayName?: string }[]>([]);
  const [voiceKey1, setVoiceKey1] = useState("mini");
  const [voiceKey2, setVoiceKey2] = useState("max");
  const [activePanel, setActivePanel] = useState<PanelId>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const stopPanelPointer = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!planBasicOk) {
      setActivePanel((p) => (p === "creative" || p === "intro" ? null : p));
    }
  }, [planBasicOk]);

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

  const voiceOptionMarks = useMemo(
    () => ({ cloneMark: t("voice.option.cloneMark"), systemMark: t("voice.option.systemMark") }),
    [t]
  );
  const voiceOptions = useMemo(
    () => buildVoiceOptionsFromMaps(mergedDefaultVoices, savedCustomVoices, systemVoicesMap, voiceOptionMarks),
    [mergedDefaultVoices, savedCustomVoices, systemVoicesMap, voiceOptionMarks]
  );

  const voiceIdSingle = useMemo(() => resolveVoiceId(voiceOptions, voiceKey1), [voiceOptions, voiceKey1]);
  const voiceId1 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey1), [voiceOptions, voiceKey1]);
  const voiceId2 = useMemo(() => resolveVoiceId(voiceOptions, voiceKey2), [voiceOptions, voiceKey2]);

  const outputMode = speakerMode === "single" ? "article" : "dialogue";

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const [d, s] = await Promise.all([
          fetch("/api/default-voices", { cache: "no-store", headers: { ...getAuthHeaders() } }),
          fetch("/api/saved_voices", { cache: "no-store", headers: { ...getAuthHeaders() } })
        ]);
        const dd = (await d.json().catch(() => ({}))) as {
          voices?: Record<string, Record<string, unknown>>;
          system_voices?: Record<string, Record<string, unknown>>;
        };
        const sd = (await s.json().catch(() => ({}))) as { voices?: { voiceId: string; displayName?: string }[] };
        if (dd.voices) setDefaultVoicesMap(dd.voices);
        if (dd.system_voices && typeof dd.system_voices === "object") setSystemVoicesMap(dd.system_voices);
        if (Array.isArray(sd.voices)) setSavedCustomVoices(sd.voices);
      } catch {
        // ignore
      }
    })();
  }, [open, getAuthHeaders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setIsMobileViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const preset = PODCAST_ROOM_PRESETS[presetKey];
    const prefix = preset.textPrefix.trim();
    setText(prefix ? `${prefix}\n\n` : "");
    setCreativeTemplateValue(DEFAULT_CREATIVE_TEMPLATE_VALUE);
  }, [open, presetKey]);

  useEffect(() => {
    if (introVoiceFollow) setIntroVoiceKey(voiceKey1);
  }, [voiceKey1, introVoiceFollow]);

  useEffect(() => {
    if (outroVoiceFollow) setOutroVoiceKey(voiceKey1);
  }, [voiceKey1, outroVoiceFollow]);

  useEffect(() => {
    const last = readLastIntroOutro("notes_room");
    if (last) applyIntroOutroSnapshot(last);
    setIntroOutroHydrated(true);
  }, [applyIntroOutroSnapshot]);

  useEffect(() => {
    if (!introOutroHydrated) return;
    const timer = window.setTimeout(() => {
      void buildIntroOutroSnapshotNow().then((snap) => writeLastIntroOutro("notes_room", snap));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [introOutroHydrated, buildIntroOutroSnapshotNow]);

  useEffect(() => {
    setScriptTargetCharsInput(String(scriptTargetChars));
  }, [scriptTargetChars]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-podcast-panel]") || t.closest("[data-floating-panel]")) return;
      if (t.closest("[data-podcast-toolbar-chip]")) return;
      if (t.closest("[data-podcast-toolbar-gen]")) return;
      setActivePanel(null);
    }
    if (activePanel && open) {
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
    }
  }, [activePanel, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActivePanel(null);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
  }, [open]);

  function commitScriptTargetCharsInput() {
    const parsed = Number(scriptTargetCharsInput);
    if (Number.isNaN(parsed)) {
      setScriptTargetCharsInput(String(scriptTargetChars));
      return;
    }
    const clamped = Math.min(50000, Math.max(200, Math.round(parsed)));
    setScriptTargetChars(clamped);
    setScriptTargetCharsInput(String(clamped));
  }

  function refPayloadMinimal() {
    return buildReferenceJobFields({
      urlListText: "",
      selectedNoteIds: lockedNoteIds,
      selectedNoteTitles: lockedNoteIds.map((id) => (noteTitleById[id] || "").trim()),
      referenceExtra: "",
      useRag: true,
      ragMaxChars: 56_000,
      referenceRagMode: "truncate"
    });
  }

  async function buildPodcastPayload(scriptCharsForJob: number) {
    const preset = PODCAST_ROOM_PRESETS[presetKey];
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

    const vMain = speakerMode === "single" ? voiceIdSingle : voiceId1;
    const v1 = voiceId1;
    const v2 = voiceId2;
    const programName = (preset.programName && preset.programName.trim()) || DEFAULT_PROGRAM_NAME;
    const bodyText = text.trim() || "请根据所选笔记与体裁要求生成播客。";
    return buildScriptPayload(
      { text: bodyText },
      {
        scriptTargetChars: scriptCharsForJob,
        scriptStyle: creativeBundle.scriptStyle,
        scriptLanguage,
        programName,
        speaker1Persona: creativeBundle.speaker1Persona,
        speaker2Persona: creativeBundle.speaker2Persona,
        scriptConstraints: creativeBundle.scriptConstraints,
        generateCover,
        ref: refPayloadMinimal(),
        outputMode,
        voiceId: vMain,
        voiceId1: v1,
        voiceId2: v2,
        introText,
        outroText,
        aiPolish: false,
        ttsExtras
      }
    );
  }

  async function runPodcast() {
    setBillingGateMessage(null);
    setBusy(true);
    try {
      const effectiveChars = resolveScriptTargetCharsForJob(scriptTargetChars, scriptTargetCharsInput);
      setScriptTargetChars(effectiveChars);
      setScriptTargetCharsInput(String(effectiveChars));
      const payload = await buildPodcastPayload(effectiveChars);
      (payload as Record<string, unknown>).notes_notebook = notebookName;
      try {
        const prev = await previewMediaJob({
          project_name: NOTES_PODCAST_PROJECT_NAME,
          job_type: "podcast_generate",
          queue_name: "media",
          payload,
          ...(createdByPhone ? { created_by: createdByPhone } : {})
        });
        if (prev.allowed === false) {
          setBillingGateMessage(prev.detail || "余额或套餐不足，请前往订阅页处理。");
          return;
        }
      } catch (pe) {
        const peMsg = String(pe instanceof Error ? pe.message : pe);
        setBillingGateMessage(peMsg);
        return;
      }
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          project_name: NOTES_PODCAST_PROJECT_NAME,
          job_type: "podcast_generate",
          queue_name: "media",
          payload,
          ...(createdByPhone ? { created_by: createdByPhone } : {})
        })
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        const msg = formatOrchestratorErrorText(errText) || `创建失败: HTTP ${createRes.status}`;
        setBillingGateMessage(msg);
        return;
      }
      const created = (await createRes.json().catch(() => ({}))) as { id?: string };
      const jobId = String(created.id || "").trim();
      if (!jobId) {
        setBillingGateMessage("创建失败: 未返回记录编号");
        return;
      }
      rememberJobId(jobId);
      setActiveGenerationJob("podcast", jobId);
      setActivePanel(null);
      onPodcastJobCreated(jobId);
      if (closeOnSuccess) onClose();
    } catch (err) {
      setBillingGateMessage(`错误: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const durationLabel = DURATION_PRESETS.find((p) => p.chars === scriptTargetChars)?.label ?? "自定义";
  const durationPresetHighlight = durationInputMatchesCommitted(scriptTargetChars, scriptTargetCharsInput);
  const voiceSummary =
    speakerMode === "single"
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
      : "未设";
  const creativeSummary = formatCreativeTemplateChip(creativeTemplateValue);

  const panelClassAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-2.5 shadow-card sm:p-3 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(52dvh,300px)]";
  const panelClassIntroAnchorMobile =
    "z-[320] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-3 shadow-card sm:p-4 " +
    "fixed left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] mx-auto max-h-[min(68dvh,520px)]";
  const panelClassAnchorDesktop =
    "z-[360] w-[min(100vw-1.25rem,26rem)] max-w-[min(100vw-1.25rem,26rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-2.5 shadow-modal sm:p-3";
  const panelClassIntroAnchorDesktop =
    "z-[360] w-[min(100vw-1.25rem,40rem)] max-w-[min(100vw-1.25rem,40rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-3 shadow-modal sm:p-4";
  const renderFloatingPanel = useCallback(
    (panelId: Exclude<PanelId, null>, mobileClass: string, desktopClass: string, ariaLabel: string, children: ReactNode) => {
      if (activePanel !== panelId) return null;
      const anchorEl =
        typeof document === "undefined"
          ? null
          : (() => {
              const node = document.querySelector(`[data-podcast-toolbar-chip-id="${panelId}"]`);
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

  useImperativeHandle(
    ref,
    () => ({
      generate: () => {
        void runPodcast();
      }
    }),
    [runPodcast]
  );

  const presetLabel = PODCAST_ROOM_PRESETS[presetKey].label;

  const cardClass =
    layout === "inline"
      ? "flex min-h-[18rem] w-full flex-col overflow-visible rounded-2xl border border-line bg-surface shadow-soft"
      : "mb-8 flex h-[min(58dvh,560px)] w-full max-w-[56rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-modal";

  if (!open) return null;

  const cardInner = (
        <div className={cardClass} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-[1] shrink-0 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div>
            <h2 id="notes-podcast-room-title" className="text-base font-semibold text-ink">
              笔记本 · 生成播客
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {presetLabel} · 「{notebookName}」 · 已选 {lockedNoteIds.length}/{maxLockedNotes}
            </p>
          </div>
          {layout === "modal" ? (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-fill hover:text-ink"
              onClick={() => !busy && onClose()}
              disabled={busy}
            >
              关闭
            </button>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
          {billingGateMessage ? (
            <div
              className="mb-3 shrink-0 rounded-xl border border-warning/40 bg-warning-soft/85 px-3 py-2.5 text-sm text-ink shadow-sm"
              role="alert"
            >
              <p className="leading-snug">{billingGateMessage}</p>
              {messageSuggestsBillingTopUpOrSubscription(billingGateMessage) ? (
                <BillingShortfallLinks className="mt-2" />
              ) : null}
            </div>
          ) : null}
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
            {controlledPrompt === undefined || layout === "modal" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-3 md:p-5">
                <textarea
                  className="h-full min-h-[min(50dvh,480px)] w-full max-w-none resize-y rounded-xl border border-line bg-fill p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  rows={14}
                  placeholder={MAIN_TEXT_PLACEHOLDER}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            ) : null}

              <div className="relative z-10 shrink-0 overflow-visible border-t border-line bg-surface/95 px-4 pb-4 pt-3 backdrop-blur md:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="mode" className="relative inline-block align-top">
                        <button type="button" className={chipClass(activePanel === "mode")} onClick={() => setActivePanel((p) => (p === "mode" ? null : "mode"))}>
                          {speakerMode === "dual" ? "双人" : "单人"}
                        </button>
                        {renderFloatingPanel(
                          "mode",
                          panelClassAnchorMobile,
                          panelClassAnchorDesktop,
                          "单人或双人",
                          <>
                            <p className="mb-3 text-sm font-medium text-ink">单人 / 双人</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={`rounded-lg px-4 py-2 text-sm ${speakerMode === "single" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                                onClick={() => setSpeakerMode("single")}
                              >
                                单人
                              </button>
                              <button
                                type="button"
                                className={`rounded-lg px-4 py-2 text-sm ${speakerMode === "dual" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                                onClick={() => setSpeakerMode("dual")}
                              >
                                双人
                              </button>
                            </div>
                          </>
                        )}
                      </span>
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="lang" className="relative inline-block align-top">
                        <button type="button" className={chipClass(activePanel === "lang")} onClick={() => setActivePanel((p) => (p === "lang" ? null : "lang"))}>
                          语言 · {scriptLanguage}
                        </button>
                        {renderFloatingPanel(
                          "lang",
                          panelClassAnchorMobile,
                          panelClassAnchorDesktop,
                          "语言",
                          <>
                            <p className="mb-2 text-sm font-medium">语言</p>
                            <div className="flex flex-wrap gap-2">
                              {LANG_OPTIONS.map((l) => (
                                <button
                                  key={l}
                                  type="button"
                                  className={`rounded-lg px-3 py-1.5 text-sm ${scriptLanguage === l ? "bg-brand text-brand-foreground" : "border border-line"}`}
                                  onClick={() => setScriptLanguage(l)}
                                >
                                  {l}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </span>
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="voice" className="relative inline-block align-top">
                        <button type="button" className={chipClass(activePanel === "voice")} onClick={() => setActivePanel((p) => (p === "voice" ? null : "voice"))}>
                          音色 · {voiceSummary}
                        </button>
                        {renderFloatingPanel(
                          "voice",
                          panelClassAnchorMobile,
                          panelClassAnchorDesktop,
                          "音色设置",
                          <>
                            <p className="mb-1 text-sm font-medium">音色</p>
                            {voiceOptions.length === 0 ? (
                              <p className="text-xs text-warning-ink">正在加载音色列表…</p>
                            ) : null}
                            {speakerMode === "single" ? (
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
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="duration" className="relative inline-block align-top">
                        <button type="button" className={chipClass(activePanel === "duration")} onClick={() => setActivePanel((p) => (p === "duration" ? null : "duration"))}>
                          时长 · {durationLabel}
                        </button>
                        {renderFloatingPanel(
                          "duration",
                          panelClassAnchorMobile,
                          panelClassAnchorDesktop,
                          "时长",
                          <>
                            <p className="mb-2 text-sm font-medium">时长</p>
                            <div className="flex flex-wrap gap-2">
                              {DURATION_PRESETS.map((p) => (
                                <button
                                  key={p.chars}
                                  type="button"
                                  className={`rounded-lg border px-3 py-2 text-left text-sm ${durationPresetHighlight && scriptTargetChars === p.chars ? "border-brand bg-fill" : "border-line"}`}
                                  onClick={() => setScriptTargetChars(p.chars)}
                                >
                                  {p.label}
                                  <span className="block text-xs text-muted">{p.hint}</span>
                                </button>
                              ))}
                            </div>
                            <label className="mt-3 block text-xs">
                              <span>字数（200–50000，以套餐为准）</span>
                              <input
                                type="number"
                                min={200}
                                max={50000}
                                className="mt-1 w-full rounded-lg border border-line p-2"
                                value={scriptTargetCharsInput}
                                onChange={(e) => setScriptTargetCharsInput(e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={commitScriptTargetCharsInput}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitScriptTargetCharsInput();
                                    setActivePanel(null);
                                  }
                                }}
                              />
                            </label>
                          </>
                        )}
                      </span>
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="intro" className="relative inline-flex max-w-full align-top">
                        {!planBasicOk ? (
                          <LockedToolbarChipPill label={<>开场/结尾 · {introSummary}</>} upgradeTitle="开场与结尾设置需要 Basic 及以上套餐" />
                        ) : (
                          <>
                            <button
                              type="button"
                              className={chipClass(activePanel === "intro")}
                              onClick={() => setActivePanel((p) => (p === "intro" ? null : "intro"))}
                            >
                              开场/结尾 · {introSummary}
                            </button>
                            {renderFloatingPanel(
                              "intro",
                              panelClassIntroAnchorMobile,
                              panelClassIntroAnchorDesktop,
                              "开场与结尾",
                              <>
                            <p className="mb-1 text-sm font-medium">开场 / 结尾</p>
                            <p className="mb-3 text-xs text-muted">开场 / 正文 / 结尾与背景音均可选。</p>
                            <IntroOutroPresetBar
                              scope="notes_room"
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
                                    className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                    rows={3}
                                    value={introText}
                                    onChange={(e) => setIntroText(e.target.value)}
                                    placeholder="例如：欢迎收听本期节目（留空可跳过）"
                                  />
                                </label>
                                <div className="mt-3 space-y-2">
                                  <span className="text-xs font-medium text-ink">音色</span>
                                  <select
                                    className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                    value={introVoiceFollow ? "follow" : "custom"}
                                    onChange={(e) => setIntroVoiceFollow(e.target.value === "follow")}
                                  >
                                    <option value="follow">默认跟随 Speaker1</option>
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
                                    className="mt-1 min-h-[4.5rem] w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                    rows={3}
                                    value={outroText}
                                    onChange={(e) => setOutroText(e.target.value)}
                                    placeholder="例如：感谢收听，我们下期再见（留空可跳过）"
                                  />
                                </label>
                                <div className="mt-3 space-y-2">
                                  <span className="text-xs font-medium text-ink">音色</span>
                                  <select
                                    className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
                                    value={outroVoiceFollow ? "follow" : "custom"}
                                    onChange={(e) => setOutroVoiceFollow(e.target.value === "follow")}
                                  >
                                    <option value="follow">默认跟随 Speaker1</option>
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
                      </>
                    )}
                      </span>
                      <span data-podcast-toolbar-chip data-podcast-toolbar-chip-id="creative" className="relative inline-flex max-w-full align-top">
                        {!planBasicOk ? (
                          <LockedToolbarChipPill label={<>加入创意 · {creativeSummary}</>} upgradeTitle="风格与创意设置需要 Basic 及以上套餐" />
                        ) : (
                          <>
                            <button
                              type="button"
                              className={chipClass(activePanel === "creative")}
                              title={CREATIVE_CHIP_HOVER_HINT}
                              onClick={() => setActivePanel((p) => (p === "creative" ? null : "creative"))}
                            >
                              加入创意 · {creativeSummary}
                            </button>
                            {renderFloatingPanel(
                              "creative",
                              panelClassAnchorMobile,
                              panelClassAnchorDesktop,
                              "加入创意",
                              <CreativeTemplatePicker value={creativeTemplateValue} onChange={setCreativeTemplateValue} />
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {!hideGenerateButton ? (
                    <button
                      type="button"
                      data-podcast-toolbar-gen
                      disabled={busy || lockedNoteIds.length === 0}
                      onClick={() => void runPodcast()}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-full bg-mint text-mint-foreground shadow-soft transition hover:bg-mint/90 disabled:opacity-40 sm:ml-1 sm:self-start"
                      aria-label="生成播客"
                      title={lockedNoteIds.length === 0 ? "请先勾选笔记" : "生成播客"}
                    >
                      {busy ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <PlayIcon className="h-4 w-4 translate-x-px" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
          </section>
        </div>
        </div>
  );

  if (layout === "inline") {
    return <div className="w-full min-w-0">{cardInner}</div>;
  }

  return (
    <div
      className="fixed inset-0 z-[280] overflow-y-auto overscroll-contain bg-black/50 p-3 py-6 sm:p-4 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-podcast-room-title"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="flex min-h-[calc(100dvh-3rem)] w-full items-start justify-center sm:min-h-[calc(100dvh-5rem)]"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
      >
        {cardInner}
      </div>
    </div>
  );
});
export default NotesPodcastRoomModal;
