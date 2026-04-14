"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAuth } from "../../lib/auth";
import { readFavoriteVoiceIds, toggleFavoriteVoiceId } from "../../lib/favoriteVoiceIdsStorage";

const GENDER_FILTER_ITEMS = [
  { id: "all", label: "全部" },
  { id: "男", label: "男声" },
  { id: "女", label: "女声" },
  { id: "其他", label: "其他" }
];

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
  const previewText = "欢迎收听我的播客节目";
  const [savedVoices, setSavedVoices] = useState<Voice[]>([]);
  const [defaultVoices, setDefaultVoices] = useState<Record<string, Record<string, unknown>>>({});
  const [libraryTab, setLibraryTab] = useState<LibraryTab>(() =>
    parseLibraryTab(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lib") : null)
  );
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    typeof window !== "undefined" ? readFavoriteVoiceIds() : []
  );
  const [searchKeyword, setSearchKeyword] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [langFilter, setLangFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
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
  const [overflowKey, setOverflowKey] = useState("");
  const [msg, setMsg] = useState("");

  const defaultVoiceTree = useMemo(() => buildSettingsVoiceTree(defaultVoices), [defaultVoices]);
  const allMetas = useMemo(() => listVoiceMetasFromVoicesObject(defaultVoices), [defaultVoices]);

  const languageChips = useMemo(() => {
    const langs: string[] = [];
    defaultVoiceTree.forEach((b) => {
      b.languages.forEach((l) => langs.push(l.language));
    });
    return sortUniqueLanguages(langs);
  }, [defaultVoiceTree]);

  const providerChips = useMemo(() => {
    const uniq = [...new Set(allMetas.map((m) => m.provider).filter(Boolean))];
    uniq.sort((a, b) => a.localeCompare(b, "zh-CN"));
    return uniq;
  }, [allMetas]);

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
        (providerFilter === "all" || m.provider === providerFilter) &&
        (voiceTypeFilter === "all" || m.voiceType === voiceTypeFilter)
    );
  }, [allMetas, genderFilter, langFilter, providerFilter, searchKeyword, voiceTypeFilter]);

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
        const dd = (await d.json().catch(() => ({}))) as { success?: boolean; voices?: Record<string, Record<string, unknown>> };
        const sd = (await s.json().catch(() => ({}))) as { success?: boolean; voices?: Voice[] };
        if (dd.success && dd.voices) setDefaultVoices(dd.voices);
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
    if (!overflowKey) return;
    const onDoc = () => setOverflowKey("");
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [overflowKey]);

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
    const textRaw = (previewText || "").trim() || "欢迎收听我的播客节目";
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
    if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "试听失败"));
    const url = hexToMp3DataUrl(String(data.audio_hex || ""));
    if (!url) throw new Error("无音频数据");
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
          setMsg("播放失败，请重试");
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
          p.catch(() => setMsg("播放未开始，请再点一次圆形播放按钮。"));
        }
      } catch {
        setMsg("播放失败，请重试");
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
      p.catch(() => setMsg("若未听到声音，请再点一次圆形播放按钮。"));
    }
  }

  async function copyVoiceId(voiceId: string) {
    const id = String(voiceId || "").trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setMsg("已复制音色 ID");
    } catch {
      setMsg("复制失败，请手动选择并复制 ID");
    }
  }

  async function submitRenameSavedVoice(voiceId: string) {
    const normalizedName = (editingVoiceName || "").trim();
    if (!normalizedName) {
      setMsg("音色名称不能为空");
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
      if (!res.ok || !data.success) throw new Error(data.error || "重命名失败");
      setSavedVoices(updatedVoices);
      setEditingVoiceId("");
      setEditingVoiceName("");
      setDetailOpen((d) =>
        d?.kind === "cloned" && d.voice.voiceId === voiceId
          ? { kind: "cloned", voice: { ...d.voice, displayName: normalizedName } }
          : d
      );
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
    setMsg(
      `已分配到 ${which === "speaker1" ? "Speaker1" : "Speaker2"}（当前预设键：${cur.speaker1} / ${cur.speaker2}，可在播客/TTS 页使用）`
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
    setOverflowKey("");
  }

  function cardTitleFor(entry: DetailModel): string {
    if (entry.kind === "preset") return entry.meta.typeShort || entry.meta.name;
    if (entry.kind === "cloned") return entry.voice.displayName || entry.voice.voiceId;
    return "未识别的音色";
  }

  function cardSubtitleFor(entry: DetailModel): string {
    if (entry.kind === "preset")
      return `${entry.meta.genderGroup === "男" ? "男声" : entry.meta.genderGroup === "女" ? "女声" : "其他"} · ${getLanguageShortLabel(entry.meta.language)}`;
    if (entry.kind === "cloned") return "我的克隆音色";
    return "仅保留 ID，详情不可用";
  }

  function renderVoiceRow(
    key: string,
    voiceId: string,
    entry: DetailModel,
    previewLabel: string,
    usePresetKey?: string
  ) {
    const fav = favSet.has(voiceId);
    const loading = loadingCardKey === key;
    const busyRename = renamingVoiceId === voiceId;
    const isMenuOpen = overflowKey === key;

    const gender =
      entry.kind === "preset" ? (entry.meta.genderGroup === "男" ? "男声" : entry.meta.genderGroup === "女" ? "女声" : "其他") : "—";
    const language = entry.kind === "preset" ? getLanguageShortLabel(entry.meta.language) : "—";
    const source =
      entry.kind === "preset"
        ? `${entry.meta.provider === "minimax" ? "MiniMax 预设" : "系统音色"}`
        : entry.kind === "cloned"
          ? "克隆音色"
          : "未知";
    const voiceType = entry.kind === "preset" ? entry.meta.voiceType : "—";
    const style = entry.kind === "preset" ? entry.meta.style || "—" : "—";
    const playing = playingCardKey === key;
    return (
      <div key={key} className="relative rounded-xl border border-line bg-surface px-3 py-2.5 shadow-soft">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-fill text-ink disabled:opacity-50"
            title={playing ? "暂停" : "试听"}
            aria-label={playing ? "暂停" : "试听"}
            disabled={loading || busyRename}
            onClick={() => void playOnCard(key, voiceId)}
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
              <span className="truncate">{cardSubtitleFor(entry)}</span>
              <span className="truncate">来源：{source}</span>
              <span className="truncate">性别：{gender}</span>
              <span className="truncate">语言：{language}</span>
              <span className="truncate">类型：{voiceType}</span>
              <span className="truncate">风格：{style}</span>
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
              使用
            </button>
            <button
              type="button"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-ink"
              onClick={() => void copyVoiceId(voiceId)}
            >
              复制 ID
            </button>
            <button
              type="button"
              className={`rounded-lg p-1.5 transition-colors ${fav ? "text-warning" : "text-muted hover:text-warning-ink"}`}
              title={fav ? "取消收藏" : "收藏"}
              aria-label={fav ? "取消收藏" : "收藏"}
              onClick={() => onToggleFavorite(voiceId)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="relative">
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                aria-label="更多"
                onClick={(e) => {
                  e.stopPropagation();
                  setOverflowKey(isMenuOpen ? "" : key);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="5" cy="12" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                </svg>
              </button>
              {isMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-20 mt-1 w-36 rounded-xl border border-line bg-surface py-1 text-sm shadow-card ring-1 ring-line/50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="flex w-full px-3 py-2 text-left hover:bg-fill"
                    onClick={() => openDetailFromResolved(entry)}
                  >
                    详情
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-0 flex gap-1 rounded-2xl border border-line bg-fill/50 p-1 shadow-soft" role="tablist" aria-label="音色库分区">
        <button type="button" role="tab" aria-selected={libraryTab === "explore"} className={subTabBtn(libraryTab === "explore")} onClick={() => setLibraryTabAndUrl("explore")}>
          探索
        </button>
        <button type="button" role="tab" aria-selected={libraryTab === "my"} className={subTabBtn(libraryTab === "my")} onClick={() => setLibraryTabAndUrl("my")}>
          我的音色
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={libraryTab === "favorites"}
          className={subTabBtn(libraryTab === "favorites")}
          onClick={() => setLibraryTabAndUrl("favorites")}
        >
          收藏音色
        </button>
      </div>

      {libraryTab === "explore" ? (
        <section className={`mt-3 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">搜索与筛选</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索名称 / ID / 类型 / 风格 / 标签"
              aria-label="搜索音色"
            />
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              aria-label="按性别筛选"
            >
              {GENDER_FILTER_ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              aria-label="按语言筛选"
            >
              <option value="all">全部语言</option>
              {languageChips.map((langCode) => (
                <option key={langCode} value={langCode}>
                  {getLanguageShortLabel(langCode)}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              aria-label="按来源筛选"
            >
              <option value="all">全部来源</option>
              {providerChips.map((provider) => (
                <option key={provider} value={provider}>
                  {provider === "minimax" ? "MiniMax" : provider}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-line bg-fill p-2.5 text-sm"
              value={voiceTypeFilter}
              onChange={(e) => setVoiceTypeFilter(e.target.value)}
              aria-label="按类型筛选"
            >
              <option value="all">全部类型</option>
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
        <section className={`mt-4 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">系统音色</h2>
          <p className="mt-1 text-xs text-muted">按列表浏览并快速试听，支持名称、来源、性别、语言、类型、风格等维度筛选。</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {filteredMetas.map((m) =>
              renderVoiceRow(`explore-${m.key}`, m.voiceId, { kind: "preset", meta: m }, m.name, m.key)
            )}
          </div>
          {filteredMetas.length === 0 ? <p className="mt-4 text-sm text-muted">当前筛选下无音色</p> : null}
        </section>
      ) : null}

      {libraryTab === "my" ? (
        <section className={`mt-4 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">克隆音色</h2>
          <p className="mt-1 text-xs text-muted">你通过音色克隆保存的音色。</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {sortedSaved.map((v) =>
              renderVoiceRow(`my-${v.voiceId}`, v.voiceId, { kind: "cloned", voice: v }, v.displayName || v.voiceId)
            )}
          </div>
          {sortedSaved.length === 0 ? <p className="mt-4 text-sm text-muted">暂无克隆音色</p> : null}
        </section>
      ) : null}

      {libraryTab === "favorites" ? (
        <section className={`mt-4 ${panel}`}>
          <h2 className="text-sm font-semibold text-ink">收藏音色</h2>
          <p className="mt-1 text-xs text-muted">在探索或我的音色中点击星标即可加入此处。</p>
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
              return renderVoiceRow(`fav-${id}-${i}`, id, entry, pl, pk);
            })}
          </div>
          {favoriteResolved.length === 0 ? <p className="mt-4 text-sm text-muted">暂无收藏，去探索或我的音色里点亮星标吧</p> : null}
        </section>
      ) : null}

      {assignOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-line bg-surface p-4 text-sm shadow-modal ring-1 ring-line/50">
            <p className="font-medium text-ink">使用音色</p>
            <p className="mt-1 text-xs text-muted">{assignOpen.label}</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand py-2.5 text-brand-foreground hover:bg-brand"
                onClick={() => confirmAssign("speaker1")}
              >
                Speaker1
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand py-2.5 text-brand-foreground hover:bg-brand"
                onClick={() => confirmAssign("speaker2")}
              >
                Speaker2
              </button>
            </div>
            <button type="button" className="mt-3 w-full text-xs text-muted hover:text-ink" onClick={() => setAssignOpen(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {detailOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="音色详情"
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
                      ? detailOpen.voice.displayName || "克隆音色"
                      : "音色详情"}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {detailOpen.kind === "preset"
                    ? `${detailOpen.meta.genderGroup === "男" ? "男声" : detailOpen.meta.genderGroup === "女" ? "女声" : "其他"} · ${getLanguageShortLabel(detailOpen.meta.language)}`
                    : detailOpen.kind === "cloned"
                      ? "我的克隆音色"
                      : "未知来源"}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-muted hover:bg-fill hover:text-ink"
                aria-label="关闭"
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
                <dt className="text-xs font-medium text-muted">音色 ID</dt>
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
                    <dt className="text-xs font-medium text-muted">预设键</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.key}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">描述</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.description || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">来源</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.provider === "minimax" ? "MiniMax" : detailOpen.meta.provider || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">类型</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.voiceType || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">风格</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.style || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">年龄段</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.ageGroup || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">口音/方言</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.accent || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">标签</dt>
                    <dd className="mt-1 text-ink">{detailOpen.meta.tags.length ? detailOpen.meta.tags.join(" / ") : "—"}</dd>
                  </div>
                </>
              ) : null}
              {detailOpen.kind === "cloned" ? (
                <>
                  <div>
                    <dt className="text-xs font-medium text-muted">创建时间</dt>
                    <dd className="mt-1 text-ink">{detailOpen.voice.createdAt || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted">最近使用</dt>
                    <dd className="mt-1 text-ink">{detailOpen.voice.lastUsedAt || "—"}</dd>
                  </div>
                  {editingVoiceId === detailOpen.voice.voiceId ? (
                    <div>
                      <dt className="text-xs font-medium text-muted">重命名</dt>
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
                            保存
                          </button>
                          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs" onClick={() => setEditingVoiceId("")}>
                            取消
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
                        重命名
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
                复制 ID
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
                  ? "取消收藏"
                  : "收藏"}
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-soft disabled:opacity-50"
                title="试听"
                aria-label="试听"
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
                  使用
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
                  使用
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

      {msg ? <p className="mt-4 text-sm text-muted">{msg}</p> : null}
    </div>
  );
}
