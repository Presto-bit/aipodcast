"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { hexToMp3DataUrl } from "../../lib/audioHex";
import {
  assignClonedVoiceToSpeaker,
  assignPresetToSpeaker,
  readSpeakerDefaultVoiceKeys
} from "../../lib/presetVoicesStorage";
import {
  buildSettingsVoiceTree,
  getLanguageShortLabel,
  listVoiceMetasFromVoicesObject,
  sortUniqueLanguages,
  type VoiceMeta
} from "../../lib/voiceCatalogUtils";
import { apiErrorMessage } from "../../lib/apiError";
import { messageLooksLikeWalletTopupHint } from "../../lib/billingShortfall";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import SystemVoicesVirtualList from "./SystemVoicesVirtualList";
import { BillingShortfallLinks } from "../subscription/BillingShortfallLinks";
import { readFavoriteVoiceIds, toggleFavoriteVoiceId } from "../../lib/favoriteVoiceIdsStorage";

type LibraryTab = "explore" | "my" | "favorites";

type Voice = {
  voiceId: string;
  displayName?: string;
  createdAt?: string;
  lastUsedAt?: string;
};

type AssignOpen = { kind: "preset" | "cloned"; key?: string; voiceId?: string; label: string };

type DetailModel =
  | { kind: "preset"; meta: VoiceMeta }
  | { kind: "cloned"; voice: Voice }
  | { kind: "orphan"; voiceId: string };

/** 与「⋯」菜单实际宽度大致匹配，用于靠右对齐时计算 left */
const VOICE_OVERFLOW_MENU_W = 168;

type OverflowMenuState = { rowKey: string; top: number; left: number; entry: DetailModel };

const panel = "rounded-2xl border border-line bg-surface p-4 shadow-soft";

function parseLibraryTab(raw: string | null): LibraryTab {
  if (raw === "my") return "my";
  if (raw === "favorites") return "favorites";
  return "explore";
}

function resolveFavoriteEntry(
  voiceId: string,
  metas: VoiceMeta[],
  savedVoices: Voice[]
): DetailModel {
  const sv = savedVoices.find((v) => v.voiceId === voiceId);
  if (sv) return { kind: "cloned", voice: sv };
  const m = metas.find((x) => x.voiceId === voiceId);
  if (m) return { kind: "preset", meta: m };
  return { kind: "orphan", voiceId };
}

export default function MyVoicesPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAuthHeaders } = useAuth();
  const { t } = useI18n();
  const previewText = t("voice.preview.defaultText");

  const genderFilterItems = useMemo(
    () => [
      { id: "all" as const, label: t("voice.filter.genderAll") },
      { id: "男" as const, label: t("voice.filter.genderMale") },
      { id: "女" as const, label: t("voice.filter.genderFemale") },
      { id: "其他" as const, label: t("voice.filter.genderOther") }
    ],
    [t]
  );
  const [savedVoices, setSavedVoices] = useState<Voice[]>([]);
  const [defaultVoices, setDefaultVoices] = useState<Record<string, Record<string, unknown>>>({});
  /** Minimax 官方系统音色表（与 orchestrator minimax_system_voices_data 同源） */
  const [systemVoices, setSystemVoices] = useState<Record<string, Record<string, unknown>>>({});
  const [libraryTab, setLibraryTab] = useState<LibraryTab>(() =>
    parseLibraryTab(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lib") : null)
  );
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    typeof window !== "undefined" ? readFavoriteVoiceIds() : []
  );
  const [searchKeyword, setSearchKeyword] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");
  const [voiceTypeFilter, setVoiceTypeFilter] = useState("all");
  /** 正在请求试听音频的卡片 key（非 voiceId，避免多卡冲突） */
  const [loadingCardKey, setLoadingCardKey] = useState("");
  const [playingCardKey, setPlayingCardKey] = useState("");
  const [cardPreviewUrls, setCardPreviewUrls] = useState<Record<string, string>>({});
  const rowAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [detailPreviewUrl, setDetailPreviewUrl] = useState<string | null>(null);
  /** 与 detailPreviewUrl 对应的 voice_id，用于详情内重播判据 */
  const [detailPreviewVoiceId, setDetailPreviewVoiceId] = useState<string | null>(null);
  const [detailPreviewLoading, setDetailPreviewLoading] = useState(false);
  const detailPendingAutoplay = useRef(false);
  const detailAudioRef = useRef<HTMLAudioElement | null>(null);
  const [editingVoiceId, setEditingVoiceId] = useState("");
  const [editingVoiceName, setEditingVoiceName] = useState("");
  const [renamingVoiceId, setRenamingVoiceId] = useState("");
  const [assignOpen, setAssignOpen] = useState<AssignOpen | null>(null);
  const [detailOpen, setDetailOpen] = useState<DetailModel | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<OverflowMenuState | null>(null);
  const [msg, setMsg] = useState("");

  /** 合并顺序：系统表在前，默认 mini/max 在后以便同 key 时以后端默认为准（一般不会冲突） */
  const mergedVoiceCatalog = useMemo(
    () => ({ ...systemVoices, ...defaultVoices }),
    [systemVoices, defaultVoices]
  );

  const defaultVoiceTree = useMemo(() => buildSettingsVoiceTree(mergedVoiceCatalog), [mergedVoiceCatalog]);
  const allMetas = useMemo(() => listVoiceMetasFromVoicesObject(mergedVoiceCatalog), [mergedVoiceCatalog]);

  const languageChips = useMemo(() => {
    const langs: string[] = [];
    defaultVoiceTree.forEach((b) => {
      b.languages.forEach((l) => langs.push(l.language));
    });
    return sortUniqueLanguages(langs);
  }, [defaultVoiceTree]);

  const voiceTypeChips = useMemo(() => {
    const uniq = [...new Set(allMetas.map((m) => m.voiceType).filter(Boolean))];
    uniq.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return uniq;
  }, [allMetas]);

  const filteredMetas = useMemo(() => {
    return allMetas.filter(
      (m) =>
        (searchKeyword.trim() === "" ||
          `${m.name} ${m.voiceId} ${m.typeShort} ${m.voiceType} ${m.language} ${m.genderGroup} ${m.style} ${m.ageGroup} ${m.accent} ${m.tags.join(" ")}`.toLowerCase().includes(searchKeyword.trim().toLowerCase())) &&
        (genderFilter === "all" || m.genderGroup === genderFilter) &&
        (langFilter === "all" || m.language === langFilter) &&
        (voiceTypeFilter === "all" || m.voiceType === voiceTypeFilter)
    );
  }, [allMetas, genderFilter, langFilter, searchKeyword, voiceTypeFilter]);

  const exploreDefaultMetas = useMemo(
    () => filteredMetas.filter((m) => m.key === "mini" || m.key === "max"),
    [filteredMetas]
  );
  const exploreSystemMetas = useMemo(
    () => filteredMetas.filter((m) => m.key !== "mini" && m.key !== "max"),
    [filteredMetas]
  );

  const sortedSaved = useMemo(() => {
    return [...savedVoices].sort((a, b) => {
      const aTs = a?.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bTs = b?.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      if (bTs !== aTs) return bTs - aTs;
      return String(a?.voiceId || "").localeCompare(String(b?.voiceId || ""));
    });
  }, [savedVoices]);

  const favoriteResolved = useMemo(() => {
    return favoriteIds.map((id) => resolveFavoriteEntry(id, allMetas, savedVoices));
  }, [favoriteIds, allMetas, savedVoices]);

  useEffect(() => {
    setLibraryTab(parseLibraryTab(searchParams?.get("lib") ?? null));
  }, [searchParams]);

  useEffect(() => {
    const sync = () => setFavoriteIds(readFavoriteVoiceIds());
    if (typeof window === "undefined") return;
    window.addEventListener("fym-favorite-voices-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("fym-favorite-voices-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [d, s] = await Promise.all([
          fetch("/api/default-voices", { headers: { ...getAuthHeaders() } }),
          fetch("/api/saved_voices", { headers: { ...getAuthHeaders() } })
        ]);
        const dd = (await d.json().catch(() => ({}))) as {
          success?: boolean;
          voices?: Record<string, Record<string, unknown>>;
          system_voices?: Record<string, Record<string, unknown>>;
        };
        const sd = (await s.json().catch(() => ({}))) as { success?: boolean; voices?: Voice[] };
        if (dd.success && dd.voices) setDefaultVoices(dd.voices);
        if (dd.success && dd.system_voices && typeof dd.system_voices === "object") setSystemVoices(dd.system_voices);
        if (sd.success && Array.isArray(sd.voices)) setSavedVoices(sd.voices);
      } catch {
        // ignore
      }
    })();
  }, [getAuthHeaders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refetchSaved = () => {
      void (async () => {
        try {
          const s = await fetch("/api/saved_voices", { headers: { ...getAuthHeaders() } });
          const sd = (await s.json().catch(() => ({}))) as { success?: boolean; voices?: Voice[] };
          if (sd.success && Array.isArray(sd.voices)) setSavedVoices(sd.voices);
        } catch {
          // ignore
        }
      })();
    };
    const syncFavoritesFromStorage = () => setFavoriteIds(readFavoriteVoiceIds());
    window.addEventListener("fym-saved-voices-changed", refetchSaved);
    window.addEventListener("fym-cloud-prefs-applied", syncFavoritesFromStorage);
    return () => {
      window.removeEventListener("fym-saved-voices-changed", refetchSaved);
      window.removeEventListener("fym-cloud-prefs-applied", syncFavoritesFromStorage);
    };
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!overflowMenu) return;
    const close = () => setOverflowMenu(null);
    document.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [overflowMenu]);

  const setLibraryTabAndUrl = useCallback(
    (tab: LibraryTab) => {
      setLibraryTab(tab);
      const qs = new URLSearchParams();
      qs.set("tab", "my");
      if (tab !== "explore") qs.set("lib", tab);
      router.replace(`/voice?${qs.toString()}`, { scroll: false });
    },
    [router]
  );

  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const onToggleFavorite = useCallback((voiceId: string) => {
    const id = String(voiceId || "").trim();
    if (!id) return;
    toggleFavoriteVoiceId(id);
    setFavoriteIds(readFavoriteVoiceIds());
    setMsg("");
  }, []);

  async function fetchPreviewMp3Url(voiceId: string): Promise<string> {
    const textRaw = (previewText || "").trim() || t("voice.preview.defaultText");
    const res = await fetch("/api/preview_voice", {
      method: "POST",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ voice_id: voiceId, text: textRaw })
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      audio_hex?: string;
      error?: string;
      detail?: unknown;
    };
    if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, t("voice.msg.previewFailed")));
    const url = hexToMp3DataUrl(String(data.audio_hex || ""));
    if (!url) throw new Error(t("voice.msg.noAudioData"));
    return url;
  }

  /** 卡片内播放：已有音频则直接重播；否则拉取后在该卡片区展示控件并自动播放 */
  async function playOnCard(cardKey: string, voiceId: string) {
    const id = String(voiceId || "").trim();
    if (!id) return;
    setMsg("");
    const previousPlayingKey = playingCardKey;
    if (previousPlayingKey && previousPlayingKey !== cardKey) {
      const prev = rowAudioRefs.current.get(previousPlayingKey);
      if (prev) {
        try {
          prev.pause();
          prev.currentTime = 0;
        } catch {
          // ignore
        }
      }
    }
    if (previousPlayingKey === cardKey) {
      const cur = rowAudioRefs.current.get(cardKey);
      if (cur && !cur.paused) {
        try {
          cur.pause();
          setPlayingCardKey("");
          return;
        } catch {
          setMsg(t("voice.msg.playFailed"));
          return;
        }
      }
    }
    let audioEl = rowAudioRefs.current.get(cardKey);
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = "metadata";
      audioEl.onended = () => setPlayingCardKey((k) => (k === cardKey ? "" : k));
      audioEl.onpause = () => {
        setPlayingCardKey((k) => (k === cardKey ? "" : k));
      };
      rowAudioRefs.current.set(cardKey, audioEl);
    }
    try {
      if (!cardPreviewUrls[cardKey]) {
        setLoadingCardKey(cardKey);
        const url = await fetchPreviewMp3Url(id);
        setCardPreviewUrls((prev) => ({ ...prev, [cardKey]: url }));
        audioEl.src = url;
      } else if (audioEl.src !== cardPreviewUrls[cardKey]) {
        audioEl.src = cardPreviewUrls[cardKey];
      }
      audioEl.currentTime = 0;
      const p = audioEl.play();
      if (p !== undefined) await p;
      setPlayingCardKey(cardKey);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
      setPlayingCardKey("");
    } finally {
      setLoadingCardKey("");
    }
  }

  async function playPreviewInDetail(voiceId: string) {
    const id = String(voiceId || "").trim();
    if (!id) return;
    setMsg("");
    if (detailPreviewVoiceId === id && detailPreviewUrl && detailAudioRef.current) {
      try {
        const el = detailAudioRef.current;
        el.currentTime = 0;
        const p = el.play();
        if (p !== undefined) {
          p.catch(() => setMsg(t("voice.msg.playNotStarted")));
        }
      } catch {
        setMsg(t("voice.msg.playFailed"));
      }
      return;
    }
    detailPendingAutoplay.current = true;
    setDetailPreviewLoading(true);
    setDetailPreviewUrl(null);
    setDetailPreviewVoiceId(null);
    try {
      const url = await fetchPreviewMp3Url(id);
      setDetailPreviewUrl(url);
      setDetailPreviewVoiceId(id);
    } catch (e) {
      detailPendingAutoplay.current = false;
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setDetailPreviewLoading(false);
    }
  }

  function onDetailAudioLoadedData(audioEl: HTMLAudioElement) {
    if (!detailPendingAutoplay.current) return;
    detailPendingAutoplay.current = false;
    const p = audioEl.play();
    if (p !== undefined) {
      p.catch(() => setMsg(t("voice.msg.playNoSound")));
    }
  }

  async function copyVoiceId(voiceId: string) {
    const id = String(voiceId || "").trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setMsg(t("voice.msg.copiedId"));
    } catch {
      setMsg(t("voice.msg.copyFailed"));
    }
  }

  async function submitRenameSavedVoice(voiceId: string) {
    const normalizedName = (editingVoiceName || "").trim();
    if (!normalizedName) {
      setMsg(t("voice.msg.nameRequired"));
      return;
    }
    const updatedVoices = savedVoices.map((v) => (v.voiceId === voiceId ? { ...v, displayName: normalizedName } : v));
    setRenamingVoiceId(voiceId);
    try {
      const res = await fetch("/api/saved_voices", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ voices: updatedVoices })
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || t("voice.msg.renameFailed"));
      setSavedVoices(updatedVoices);
      setEditingVoiceId("");
      setEditingVoiceName("");
      setDetailOpen((d) =>
        d?.kind === "cloned" && d.voice.voiceId === voiceId
          ? { kind: "cloned", voice: { ...d.voice, displayName: normalizedName } }
          : d
      );
      try {
        window.dispatchEvent(new Event("fym-saved-voices-changed"));
      } catch {
        // ignore
      }
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setRenamingVoiceId("");
    }
  }

  function confirmAssign(which: "speaker1" | "speaker2") {
    if (!assignOpen) return;
    if (assignOpen.kind === "preset" && assignOpen.key) {
      assignPresetToSpeaker(which, assignOpen.key);
    }
    if (assignOpen.kind === "cloned" && assignOpen.voiceId) {
      assignClonedVoiceToSpeaker(which, assignOpen.voiceId);
    }
    const cur = readSpeakerDefaultVoiceKeys();
    const speakerLabel = which === "speaker1" ? t("voice.assign.speaker1") : t("voice.assign.speaker2");
    setMsg(
      t("voice.assign.success")
        .replace("{speaker}", speakerLabel)
        .replace("{k1}", cur.speaker1)
        .replace("{k2}", cur.speaker2)
    );
    setAssignOpen(null);
  }

  const subTabBtn = (active: boolean) =>
    [
      "min-w-0 flex-1 whitespace-nowrap rounded-xl px-2 py-2.5 text-center text-sm font-medium transition-colors sm:px-3",
      active ? "bg-brand text-brand-foreground shadow-soft" : "text-muted hover:bg-surface/80 hover:text-ink"
    ].join(" ");

  function openDetailFromResolved(entry: DetailModel) {
    setDetailPreviewUrl(null);
    setDetailPreviewVoiceId(null);
    detailPendingAutoplay.current = false;
    setDetailPreviewLoading(false);
    try {
      detailAudioRef.current?.pause();
    } catch {
      // ignore
    }
    setDetailOpen(entry);
    setEditingVoiceId("");
    setEditingVoiceName("");
    setOverflowMenu(null);
  }

  function openRenameForClonedVoice(voice: Voice) {
    setOverflowMenu(null);
    setDetailPreviewUrl(null);
    setDetailPreviewVoiceId(null);
    detailPendingAutoplay.current = false;
    setDetailPreviewLoading(false);
    try {
      detailAudioRef.current?.pause();
    } catch {
      // ignore
    }
    setDetailOpen({ kind: "cloned", voice });
    setEditingVoiceId(voice.voiceId);
    setEditingVoiceName((voice.displayName || voice.voiceId || "").trim());
  }

  function cardTitleFor(entry: DetailModel): string {
    if (entry.kind === "preset") return (entry.meta.name || "").trim() || entry.meta.typeShort;
    if (entry.kind === "cloned") return entry.voice.displayName || entry.voice.voiceId;
    return t("voice.detail.orphanTitle");
  }

  function renderVoiceRow(
    rowKey: string,
    voiceId: string,
    entry: DetailModel,
    previewLabel: string,
    usePresetKey?: string
  ) {
    const fav = favSet.has(voiceId);
    const loading = loadingCardKey === rowKey;
    const busyRename = renamingVoiceId === voiceId;
    const isMenuOpen = overflowMenu?.rowKey === rowKey;

    const gender =
      entry.kind === "preset"
        ? entry.meta.genderGroup === "男"
          ? t("voice.row.male")
          : entry.meta.genderGroup === "女"
            ? t("voice.row.female")
            : t("voice.row.otherGender")
        : t("voice.row.dash");
    const language = entry.kind === "preset" ? getLanguageShortLabel(entry.meta.language) : t("voice.row.dash");
    const voiceType = entry.kind === "preset" ? entry.meta.voiceType : t("voice.row.dash");
    const style = entry.kind === "preset" ? entry.meta.style || t("voice.row.dash") : t("voice.row.dash");
    const playing = playingCardKey === rowKey;
    return (
      <div className="relative rounded-xl border border-line bg-surface px-3 py-2.5 shadow-soft">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-fill text-ink disabled:opacity-50"
            title={playing ? t("voice.preview.pause") : t("voice.preview.play")}
            aria-label={playing ? t("voice.preview.pause") : t("voice.preview.play")}
            disabled={loading || busyRename}
            onClick={() => void playOnCard(rowKey, voiceId)}
          >
            {loading ? (
              <span className="text-xs text-muted">…</span>
            ) : playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.14v14l11-7-11-7z" />
              </svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{cardTitleFor(entry)}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
              <span className="truncate">
                {t("voice.row.gender")}：{gender}
              </span>
              <span className="truncate">
                {t("voice.row.language")}：{language}
              </span>
              <span className="truncate">
                {t("voice.row.voiceType")}：{voiceType}
              </span>
              <span className="truncate">
                {t("voice.row.style")}：{style}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink"
              disabled={busyRename}
              onClick={() => {
                if (usePresetKey) {
                  setAssignOpen({ kind: "preset", key: usePresetKey, label: previewLabel });
                } else {
                  setAssignOpen({ kind: "cloned", voiceId, label: previewLabel });
                }
              }}
            >
              {t("voice.action.use")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink"
              onClick={() => void copyVoiceId(voiceId)}
            >
              {t("voice.action.copyId")}
            </button>
            <button
              type="button"
              className={`rounded-lg p-1.5 transition-colors ${fav ? "text-warning" : "text-muted hover:text-warning-ink"}`}
              title={fav ? t("voice.action.unfavorite") : t("voice.action.favorite")}
              aria-label={fav ? t("voice.action.unfavorite") : t("voice.action.favorite")}
              onClick={() => onToggleFavorite(voiceId)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
              aria-label={t("voice.action.more")}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                if (isMenuOpen) {
                  setOverflowMenu(null);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                const pad = 8;
                const left = Math.min(
                  Math.max(pad, r.right - VOICE_OVERFLOW_MENU_W),
                  typeof window !== "undefined" ? window.innerWidth - VOICE_OVERFLOW_MENU_W - pad : r.right - VOICE_OVERFLOW_MENU_W
                );
                setOverflowMenu({
                  rowKey,
                  top: r.bottom + 4,
                  left,
                  entry
                });
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="mt-0 flex gap-1 rounded-2xl border border-line bg-fill/50 p-1 shadow-soft"
        role="tablist"
        aria-label={t("voice.library.tablistAria")}
      >
        <button type="button" role="tab" aria-selected={libraryTab === "explore"} className={subTabBtn(libraryTab === "explore")} onClick={() => setLibraryTabAndUrl("explore")}>
          {t("voice.library.tabExplore")}
        </button>
        <button type="button" role="tab" aria-selected={libraryTab === "my"} className={subTabBtn(libraryTab === "my")} onClick={() => setLibraryTabAndUrl("my")}>
          {t("voice.library.tabMy")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={libraryTab === "favorites"}
          className={subTabBtn(libraryTab === "favorites")}
          onClick={() => setLibraryTabAndUrl("favorites")}
        >
          {t("voice.library.tabFavorites")}
        </button>
      </div>

      {libraryTab === "explore" ? (
        <section className={`mt-3 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">{t("voice.library.searchTitle")}</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder={t("voice.library.searchPlaceholder")}
              aria-label={t("voice.library.searchAria")}
            />
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              aria-label={t("voice.filter.genderAria")}
            >
              {genderFilterItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              aria-label={t("voice.filter.langAria")}
            >
              <option value="all">{t("voice.filter.allLang")}</option>
              {languageChips.map((langCode) => (
                <option key={langCode} value={langCode}>
                  {getLanguageShortLabel(langCode)}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={voiceTypeFilter}
              onChange={(e) => setVoiceTypeFilter(e.target.value)}
              aria-label={t("voice.filter.typeAria")}
            >
              <option value="all">{t("voice.filter.allType")}</option>
              {voiceTypeChips.map((voiceType) => (
                <option key={voiceType} value={voiceType}>
                  {voiceType}
                </option>
              ))}
            </select>
          </div>
        </section>
      ) : null}

      {libraryTab === "explore" ? (
        <>
          <section className={`mt-4 ${panel}`}>
            <h2 className="text-sm font-semibold text-ink">{t("voice.library.defaultTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("voice.library.defaultDesc")}</p>
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              {exploreDefaultMetas.map((m) => (
                <div key={`explore-def-${m.key}`}>
                  {renderVoiceRow(`explore-def-${m.key}`, m.voiceId, { kind: "preset", meta: m }, m.name, m.key)}
                </div>
              ))}
            </div>
            {exploreDefaultMetas.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("voice.library.defaultEmpty")}</p>
            ) : null}
          </section>
          <section className={`mt-4 ${panel}`}>
            <h2 className="text-sm font-semibold text-ink">{t("voice.library.systemTitle")}</h2>
            {exploreSystemMetas.length === 0 ? (
              <p className="mt-4 text-sm text-muted">{t("voice.library.systemEmpty")}</p>
            ) : (
              <SystemVoicesVirtualList
                itemsLength={exploreSystemMetas.length}
                onScroll={() => setOverflowMenu(null)}
              >
                {(index) => {
                  const m = exploreSystemMetas[index];
                  return renderVoiceRow(
                    `explore-sys-${m.key}`,
                    m.voiceId,
                    { kind: "preset", meta: m },
                    m.name,
                    m.key
                  );
                }}
              </SystemVoicesVirtualList>
            )}
          </section>
        </>
      ) : null}

      {libraryTab === "my" ? (
        <section className={`mt-4 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">{t("voice.library.clonedTitle")}</h2>
          <p className="mt-1 text-xs text-muted">{t("voice.library.clonedDesc")}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {sortedSaved.map((v) => (
              <div key={`my-${v.voiceId}`}>
                {renderVoiceRow(`my-${v.voiceId}`, v.voiceId, { kind: "cloned", voice: v }, v.displayName || v.voiceId)}
              </div>
            ))}
          </div>
          {sortedSaved.length === 0 ? <p className="mt-4 text-sm text-muted">{t("voice.library.clonedEmpty")}</p> : null}
        </section>
      ) : null}

      {libraryTab === "favorites" ? (
        <section className={`mt-4 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">{t("voice.library.favoritesTitle")}</h2>
          <p className="mt-1 text-xs text-muted">{t("voice.library.favoritesDesc")}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {favoriteResolved.map((entry, i) => {
              const id = entry.kind === "orphan" ? entry.voiceId : entry.kind === "preset" ? entry.meta.voiceId : entry.voice.voiceId;
              const pl =
                entry.kind === "preset"
                  ? entry.meta.name
                  : entry.kind === "cloned"
                    ? entry.voice.displayName || entry.voice.voiceId
                    : entry.voiceId;
              const pk = entry.kind === "preset" ? entry.meta.key : undefined;
              return (
                <div key={`fav-${id}-${i}`}>
                  {renderVoiceRow(`fav-${id}-${i}`, id, entry, pl, pk)}
                </div>
              );
            })}
          </div>
          {favoriteResolved.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("voice.library.favoritesEmpty")}</p>
          ) : null}
        </section>
      ) : null}

      {assignOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-line bg-surface p-4 text-sm shadow-modal ring-1 ring-line/50">
            <p className="font-medium text-ink">{t("voice.assign.title")}</p>
            <p className="mt-1 text-xs text-muted">{assignOpen.label}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand py-2.5 text-brand-foreground hover:bg-brand"
                onClick={() => confirmAssign("speaker1")}
              >
                {t("voice.assign.speaker1")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand py-2.5 text-brand-foreground hover:bg-brand"
                onClick={() => confirmAssign("speaker2")}
              >
                {t("voice.assign.speaker2")}
              </button>
            </div>
            <button type="button" className="mt-3 w-full text-xs text-muted hover:text-ink" onClick={() => setAssignOpen(null)}>
              {t("voice.assign.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {detailOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("voice.detail.title")}
          onClick={() => {
            try {
              detailAudioRef.current?.pause();
            } catch {
              // ignore
            }
            setDetailOpen(null);
            setDetailPreviewUrl(null);
            setDetailPreviewVoiceId(null);
            detailPendingAutoplay.current = false;
          }}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">
                  {detailOpen.kind === "preset"
                    ? detailOpen.meta.name
                    : detailOpen.kind === "cloned"
                      ? detailOpen.voice.displayName || t("voice.source.clone")
                      : t("voice.detail.orphanTitle")}
                </h3>
                {detailOpen.kind === "preset" ? null : (
                  <p className="mt-1 text-xs text-muted">
                    {detailOpen.kind === "cloned" ? t("voice.detail.clonedSub") : t("voice.detail.orphanSub")}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-muted hover:bg-fill hover:text-ink"
                aria-label={t("voice.detail.close")}
                onClick={() => {
                  try {
                    detailAudioRef.current?.pause();
                  } catch {
                    // ignore
                  }
                  setDetailOpen(null);
                  setDetailPreviewUrl(null);
                  setDetailPreviewVoiceId(null);
                  detailPendingAutoplay.current = false;
                }}
              >
                ✕
              </button>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldVoiceId")}</dt>
                <dd className="mt-1 break-all font-mono text-xs text-ink">
                  {detailOpen.kind === "preset"
                    ? detailOpen.meta.voiceId
                    : detailOpen.kind === "cloned"
                      ? detailOpen.voice.voiceId
                      : detailOpen.voiceId}
                </dd>
              </div>
              {detailOpen.kind === "preset" ? (
                <>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldPresetKey")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.key}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldDescription")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.description || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldVoiceType")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.voiceType || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldStyle")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.style || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldAge")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.ageGroup || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldAccent")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.accent || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.fieldTags")}</dt>
                    <dd className="mt-1 text-ink">
                      {detailOpen.meta.tags.length ? detailOpen.meta.tags.join(" / ") : t("voice.detail.placeholder")}
                    </dd>
                  </div>
                </>
              ) : null}
              {detailOpen.kind === "cloned" ? (
                <>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.createdAt")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.voice.createdAt || t("voice.detail.placeholder")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">{t("voice.detail.lastUsed")}</dt>
                    <dd className="mt-1 text-ink">{detailOpen.voice.lastUsedAt || t("voice.detail.placeholder")}</dd>
                  </div>
                  {editingVoiceId === detailOpen.voice.voiceId ? (
                    <div>
                      <dt className="text-xs font-medium text-muted">{t("voice.detail.rename")}</dt>
                      <dd className="mt-2 space-y-2">
                        <input
                          className="w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm"
                          value={editingVoiceName}
                          onChange={(e) => setEditingVoiceName(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-brand px-3 py-1.5 text-xs text-brand-foreground"
                            disabled={!!renamingVoiceId}
                            onClick={() => void submitRenameSavedVoice(detailOpen.voice.voiceId)}
                          >
                            {t("voice.detail.save")}
                          </button>
                          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs" onClick={() => setEditingVoiceId("")}>
                            {t("voice.detail.cancelRename")}
                          </button>
                        </div>
                      </dd>
                    </div>
                  ) : (
                    <div className="pt-1">
                      <button
                        type="button"
                        className="text-xs font-medium text-brand hover:underline"
                        onClick={() => {
                          setEditingVoiceId(detailOpen.voice.voiceId);
                          setEditingVoiceName((detailOpen.voice.displayName || detailOpen.voice.voiceId || "").trim());
                        }}
                      >
                        {t("voice.detail.rename")}
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-xs font-medium"
                onClick={() => {
                  const id =
                    detailOpen.kind === "preset"
                      ? detailOpen.meta.voiceId
                      : detailOpen.kind === "cloned"
                        ? detailOpen.voice.voiceId
                        : detailOpen.voiceId;
                  void copyVoiceId(id);
                }}
              >
                {t("voice.action.copyId")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-xs font-medium"
                onClick={() => {
                  const id =
                    detailOpen.kind === "preset"
                      ? detailOpen.meta.voiceId
                      : detailOpen.kind === "cloned"
                        ? detailOpen.voice.voiceId
                        : detailOpen.voiceId;
                  onToggleFavorite(id);
                }}
              >
                {favSet.has(
                  detailOpen.kind === "preset"
                    ? detailOpen.meta.voiceId
                    : detailOpen.kind === "cloned"
                      ? detailOpen.voice.voiceId
                      : detailOpen.voiceId
                )
                  ? t("voice.action.unfavorite")
                  : t("voice.action.favorite")}
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-soft disabled:opacity-50"
                title={t("voice.preview.play")}
                aria-label={t("voice.preview.play")}
                disabled={detailPreviewLoading}
                onClick={() => {
                  if (detailOpen.kind === "preset") {
                    void playPreviewInDetail(detailOpen.meta.voiceId);
                  } else if (detailOpen.kind === "cloned") {
                    void playPreviewInDetail(detailOpen.voice.voiceId);
                  } else {
                    void playPreviewInDetail(detailOpen.voiceId);
                  }
                }}
              >
                {detailPreviewLoading ? (
                  <span className="text-xs text-muted">…</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.14v14l11-7-11-7z" />
                  </svg>
                )}
              </button>
              {detailOpen.kind === "preset" ? (
                <button
                  type="button"
                  className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-brand-foreground"
                  onClick={() => {
                    setAssignOpen({ kind: "preset", key: detailOpen.meta.key, label: detailOpen.meta.name });
                    try {
                      detailAudioRef.current?.pause();
                    } catch {
                      // ignore
                    }
                    setDetailOpen(null);
                    setDetailPreviewUrl(null);
                    setDetailPreviewVoiceId(null);
                    detailPendingAutoplay.current = false;
                  }}
                >
                  {t("voice.action.use")}
                </button>
              ) : null}
              {detailOpen.kind === "cloned" ? (
                <button
                  type="button"
                  className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-brand-foreground"
                  onClick={() => {
                    setAssignOpen({
                      kind: "cloned",
                      voiceId: detailOpen.voice.voiceId,
                      label: detailOpen.voice.displayName || detailOpen.voice.voiceId
                    });
                    try {
                      detailAudioRef.current?.pause();
                    } catch {
                      // ignore
                    }
                    setDetailOpen(null);
                    setDetailPreviewUrl(null);
                    setDetailPreviewVoiceId(null);
                    detailPendingAutoplay.current = false;
                  }}
                >
                  {t("voice.action.use")}
                </button>
              ) : null}
            </div>
            {detailOpen ? (
              <audio
                ref={detailAudioRef}
                src={detailPreviewUrl || undefined}
                preload="auto"
                className="hidden"
                aria-hidden
                onLoadedData={(e) => onDetailAudioLoadedData(e.currentTarget)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {overflowMenu
        ? createPortal(
            <div
              className="fixed z-[100] min-w-[9rem] max-w-[min(12rem,calc(100vw-16px))] rounded-xl border border-line bg-surface py-1 text-sm shadow-card ring-1 ring-line/50"
              style={{ top: overflowMenu.top, left: overflowMenu.left }}
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              {overflowMenu.entry.kind === "cloned" ? (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full px-3 py-2 text-left hover:bg-fill"
                  onClick={() => {
                    const entry = overflowMenu.entry;
                    if (entry.kind === "cloned") {
                      openRenameForClonedVoice(entry.voice);
                    }
                  }}
                >
                  {t("voice.detail.rename")}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-left hover:bg-fill"
                onClick={() => openDetailFromResolved(overflowMenu.entry)}
              >
                {t("voice.action.detail")}
              </button>
            </div>,
            document.body
          )
        : null}

      {msg ? (
        <div className="mt-4 text-sm text-muted">
          <p>{msg}</p>
          {messageLooksLikeWalletTopupHint(msg) ? <BillingShortfallLinks className="mt-2" /> : null}
        </div>
      ) : null}
    </div>
  );
}
