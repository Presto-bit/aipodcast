"use client";

import dynamic from "next/dynamic";
import type { ChangeEvent, Dispatch, PointerEvent, SetStateAction } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import InlineConfirmBar from "../../components/ui/InlineConfirmBar";
import InlineTextPrompt from "../../components/ui/InlineTextPrompt";
import SmallPromptModal from "../../components/ui/SmallPromptModal";
import EmptyState from "../../components/ui/EmptyState";
const NotesPodcastRoomModal = dynamic(() => import("../../components/notes/NotesPodcastRoomModal"));
const PodcastWorksGallery = dynamic(() => import("../../components/podcast/PodcastWorksGallery"), {
  loading: () => (
    <div
      className="min-h-[120px] rounded-2xl border border-line/50 bg-fill/40"
      aria-busy
      aria-label="加载作品列表"
    />
  )
});
const NoteMarkdownPreview = dynamic(() => import("../../components/notes/NoteMarkdownPreview"), {
  loading: () => (
    <div
      className="flex min-h-[200px] items-center justify-center rounded-2xl border border-line/50 bg-fill/40 text-sm text-muted"
      aria-busy
      aria-label="加载预览"
    />
  )
});
import { NotesAskAnswerDisplay } from "../../components/notes/NotesAskAnswerDisplay";
import { createJob } from "../../lib/api";
import {
  apiErrorMessage,
  formatNotesAskStreamError,
  type NotesAskStreamErrorMeta
} from "../../lib/apiError";
import {
  notesAskBffUrl,
  notesAskFetchCredentials,
  notesAskResolveRequestUrl
} from "../../lib/notesAskBffOrigin";
import { clearActiveGenerationJob, readActiveGenerationJob, setActiveGenerationJob } from "../../lib/activeJobSession";
import { rememberJobId } from "../../lib/jobRecent";
import { buildReferenceJobFields, type ReferenceRagMode } from "../../lib/jobReferencePayload";
import { isJobEventLogOnlyForUi } from "../../lib/jobEventStreamUi";
import { presentJobProgressMessageForUser } from "../../lib/jobProgressUserText";
import { MEDIA_QUEUE_STALL_HINT_MS } from "../../lib/mediaQueueStallHint";
import { PODCAST_ROOM_PRESETS, type PodcastRoomPresetKey } from "../../lib/notesRoomPresets";
import { ART_KIND_PRESETS, type ArtKindKey } from "../../lib/artKindPresets";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { NOTES_NAV_HUB_EVENT, writeLastNotebookName } from "../../lib/notesLastNotebook";
import { readDraftSourceIdsForNotebook, writeDraftSourceIdsForNotebook } from "../../lib/notesDraftSourcesStorage";
import {
  APP_SIDEBAR_COLLAPSED_KEY,
  APP_SIDEBAR_COLLAPSE_EVENT,
  APP_SIDEBAR_TOGGLE_EVENT
} from "../../lib/appSidebarCollapse";
import { SIDEBAR_COLLAPSED_STORAGE } from "../../lib/appShellLayout";
import { jobEventsSourceUrl } from "../../lib/authHeaders";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/I18nContext";
import type { NotebookCoverMeta } from "../../lib/notebookCoverDisplay";
import { notebookCoverImageUrl } from "../../lib/notebookCoverDisplay";
import { maxNotesForReference, notesRefSelectionLimitMessage } from "../../lib/noteReferenceLimits";
import { BillingShortfallLinks } from "../../components/subscription/BillingShortfallLinks";
import { messageSuggestsBillingTopUpOrSubscription } from "../../lib/billingShortfall";
import {
  normalizeNotesAskSources,
  type NotesAskSource,
  type NotesAskWebSource
} from "../../lib/notesAskCitation";
import { loadNotesAskChat, saveNotesAskChat } from "../../lib/notesAskChatStorage";
import { notesAskClientLog } from "../../lib/notesAskClientLog";
import {
  accountKeyFromUser,
  readLocalStorageScoped,
  readSessionStorageScoped,
  removeSessionStorageScoped,
  writeLocalStorageScoped
} from "../../lib/userScopedStorage";
import { uploadNoteFileWithProgress } from "../../lib/uploadNoteFile";
import type { WorkItem } from "../../lib/worksTypes";

type NotesAskStreamEvent =
  | { type: "chunk"; text: string; streamRole?: "reasoning" | "answer" }
  | { type: "done"; sources?: unknown; webSources?: unknown; traceId?: string | null }
  | { type: "info"; message: string; code?: string; requestId?: string }
  | {
      type: "error";
      message: string;
      code?: string;
      detail?: string;
      requestId?: string;
      textProvider?: string;
      hint?: string;
    };

type NotesAskTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  /** 流式阶段暂存模型推理文本；完成或中断后不写入持久化 */
  streamingReasoning?: string;
  /** 编排器 done 事件中的 sources，用于 [n] 脚注与内链 */
  sources?: NotesAskSource[];
  /** 联网检索 done.webSources，[w1] 脚注 */
  webSources?: NotesAskWebSource[];
  /** 引导气泡：可点击填入下方输入框 */
  hintSuggestions?: string[];
};

function notesAskClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isNotesAskAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

function noteExtLabel(ext: string | undefined): string {
  const e = String(ext || "").trim().toLowerCase();
  if (!e) return "txt";
  if (e === "url" || e === "web") return "网页";
  return e;
}

function deriveSourcePreprocessStage(note: {
  parseState?: string;
  parseErrorCode?: string;
  preprocessSummary?: string;
  preprocessEntities?: string[];
  preprocessTags?: string[];
  retrieveState?: string;
}): { stage: "解析中" | "摘要中" | "实体提取中" | "索引中" | "可问答"; nextAction: string } {
  if (note.parseState === "failed" || note.parseState === "partial") {
    return {
      stage: "解析中",
      nextAction: note.parseErrorCode
        ? `解析未成功（${note.parseErrorCode}），建议重传 txt/md/html 或检查原文件质量。`
        : "解析处理中，请稍后刷新。"
    };
  }
  if (!String(note.preprocessSummary || "").trim()) {
    return { stage: "摘要中", nextAction: "等待摘要生成完成后即可进入下一阶段。" };
  }
  if (!((note.preprocessEntities || []).length > 0)) {
    return { stage: "实体提取中", nextAction: "等待关键实体抽取完成。" };
  }
  if ((note.retrieveState || "") !== "indexed") {
    return {
      stage: "索引中",
      nextAction:
        note.retrieveState === "failed" ? "索引失败，建议稍后重试或重新上传来源。" : "正在构建检索索引。"
    };
  }
  if (!((note.preprocessTags || []).length > 0)) {
    return { stage: "索引中", nextAction: "标签补全中，索引已可用。" };
  }
  return { stage: "可问答", nextAction: "来源已就绪，可直接提问。" };
}

function isSourceUsable(note: {
  parseState?: string;
  sourceReady?: boolean;
  citeState?: string;
}): boolean {
  if ((note.parseState || "") === "failed") return false;
  if (note.sourceReady === false) return false;
  if ((note.citeState || "") === "unavailable") return false;
  return true;
}

type NoteItem = {
  noteId: string;
  title?: string;
  notebook?: string;
  ext?: string;
  relativePath?: string;
  createdAt?: string;
  sourceUrl?: string;
  inputType?: string;
  sourceReady?: boolean;
  sourceHint?: string;
  ragChunkCount?: number;
  ragIndexError?: string;
  ragIndexedAt?: string;
  parseStatus?: string;
  parseEngine?: string;
  parseDetail?: string;
  parseEncoding?: string;
  parseOk?: boolean;
  parseState?: "success" | "partial" | "failed" | string;
  parseErrorCode?: string;
  citeState?: "ready" | "limited" | "unavailable" | string;
  retrieveState?: "indexed" | "indexing" | "failed" | "not_ready" | string;
  preprocessStatus?: string;
  preprocessSummary?: string;
  preprocessTags?: string[];
  preprocessEntities?: string[];
};

type NotesResp = {
  success?: boolean;
  notes?: NoteItem[];
  has_more?: boolean;
  error?: string;
  sharedAccess?: "read_only" | "edit" | null;
  sharedFromOwnerUserId?: string | null;
};

type PreviewResp = {
  success?: boolean;
  title?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
  ragChunkCount?: number;
  ragIndexError?: string;
  ragIndexedAt?: string;
  parseStatus?: string;
  parseEngine?: string;
  parseDetail?: string;
  parseEncoding?: string;
  parseOk?: boolean;
  parseState?: "success" | "partial" | "failed" | string;
  parseErrorCode?: string;
  citeState?: "ready" | "limited" | "unavailable" | string;
  retrieveState?: "indexed" | "indexing" | "failed" | "not_ready" | string;
  preprocessStatus?: string;
  preprocessSummary?: string;
  preprocessTags?: string[];
  preprocessEntities?: string[];
  preprocessStage?: string;
  nextAction?: string;
  sourceType?: string;
  sourceUrl?: string;
  createdAt?: string;
  wordCount?: number;
};

const card =
  "rounded-2xl border border-line bg-surface p-4 shadow-soft";
const inputCls =
  "rounded-lg border border-line bg-fill p-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

const LANG_OPTIONS_ART = ["中文", "English", "日本語"] as const;
const NOTE_PAGE = 30;
const NOTEBOOK_STATS_PAGE = 500;

/** 需要先打开笔记本时的统一提示 */
const NOTES_NEED_NOTEBOOK = "请先进入笔记本";
/** 未在左侧来源勾选资料时的统一提示（占位、无障碍、按钮与校验） */
const NOTES_ASK_SOURCE_REQUIRED = "请先勾选左侧资料";

/** 构建时注入；为 `1` 时在对话输入区上方展示与 POST 一致的 JSON 与 curl（勿对终端用户开启） */
const NOTES_ASK_DEBUG_BODY_ENABLED = String(process.env.NEXT_PUBLIC_NOTES_ASK_DEBUG_BODY || "").trim() === "1";

/** 笔记「生成文章」目标字数（含小红书等体裁），与提交 payload 上下限一致 */
const NOTES_ART_TARGET_CHARS_MIN = 200;
const NOTES_ART_TARGET_CHARS_MAX = 50_000;
const NOTES_ART_TARGET_CHARS_DEFAULT = 200;
const NOTES_ART_TARGET_CHARS_SLIDER_STEP = 100;

function simplifySourceText(text: string): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    if (/^(https?:\/\/|www\.)/i.test(s)) continue;
    if (s.length <= 1) continue;
    if (/^(导航|目录|上一篇|下一篇|相关阅读|免责声明|版权|返回顶部)$/i.test(s)) continue;
    out.push(raw);
  }
  return out.join("\n");
}

/** Bash 下单引号字符串转义，供复制 curl 使用 */
function shellSingleQuoteForCurl(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildNotesAskCurlCommand(url: string, jsonOneLine: string, auth: Record<string, string>): string {
  const parts: string[] = [`curl -N -v ${shellSingleQuoteForCurl(url)} \\`];
  parts.push(`  -H ${shellSingleQuoteForCurl("Content-Type: application/json")} \\`);
  parts.push(`  -H ${shellSingleQuoteForCurl("x-request-id: $(uuidgen)")} \\`);
  for (const [k, v] of Object.entries(auth)) {
    const val = String(v || "").trim();
    if (!val) continue;
    parts.push(`  -H ${shellSingleQuoteForCurl(`${k}: ${val}`)} \\`);
  }
  parts.push(`  -b ${shellSingleQuoteForCurl("fym_session=PASTE")} \\`);
  parts.push(`  --data-raw ${shellSingleQuoteForCurl(jsonOneLine)}`);
  return parts.join("\n");
}

const NOTEBOOK_CARD_THEMES = [
  {
    card: "border-info/35 bg-gradient-to-br from-info/[0.08] via-surface to-info/[0.15]",
    iconWrap: "bg-info-soft text-info-ink",
    chip: "bg-info-soft/90 text-info-ink"
  },
  {
    card: "border-brand/35 bg-gradient-to-br from-brand/[0.08] via-surface to-brand/[0.15]",
    iconWrap: "bg-brand/15 text-brand",
    chip: "bg-brand/12 text-brand"
  },
  {
    card: "border-success/35 bg-gradient-to-br from-success/[0.08] via-surface to-success/[0.15]",
    iconWrap: "bg-success-soft text-success-ink",
    chip: "bg-success-soft/90 text-success-ink"
  },
  {
    card: "border-warning/35 bg-gradient-to-br from-warning/[0.08] via-surface to-warning/[0.15]",
    iconWrap: "bg-warning-soft text-warning-ink",
    chip: "bg-warning-soft/90 text-warning-ink"
  },
  {
    card: "border-danger/35 bg-gradient-to-br from-danger/[0.08] via-surface to-danger/[0.12]",
    iconWrap: "bg-danger-soft text-danger-ink",
    chip: "bg-danger-soft/90 text-danger-ink"
  },
  {
    card: "border-cta/35 bg-gradient-to-br from-cta/[0.08] via-surface to-cta/[0.15]",
    iconWrap: "bg-cta/15 text-cta",
    chip: "bg-cta/12 text-cta"
  }
] as const;
const NOTEBOOK_ICONS = ["📘", "📙", "🗂️", "🧠", "🧪", "🪄", "🛰️", "📝"] as const;

type NotebookMeta = {
  noteCount: number;
  /** 与侧栏「来源」、热门笔记本 API 一致：该笔记本下资料笔记条数（非仅含链接的笔记） */
  sourceCount: number;
  createdAt: string;
  /** 新建笔记本时生成，参与本地对话存储键，避免同名删除再建串会话 */
  instanceId?: string;
};

type NotebookVisual = {
  themeIndex: number;
  iconIndex: number;
};

type NotebookSharingRow = {
  isPublic: boolean;
  publicAccess: "read_only" | "edit" | null;
  viewCount: number;
  /** 是否在「热门笔记本」发现列表展示（与 isPublic 解耦） */
  listedInDiscover?: boolean;
};

type PopularNotebookItem = {
  ownerUserId: string;
  notebook: string;
  publicAccess: string;
  viewCount: number;
  ownerDisplayName: string;
  /** 笔记本内资料（笔记）条数，与「我的笔记本」卡片「来源」一致 */
  sourceCount?: number;
  /** 最近一条笔记的创建时间（ISO） */
  latestSourceAt?: string;
  coverMode?: string;
  coverPresetId?: string | null;
  hasUploadThumb?: boolean;
  autoCoverNoteId?: string | null;
};

type SharedBrowseContext = {
  ownerUserId: string;
  access: "read_only" | "edit";
};

const NOTEBOOK_VISUAL_STORAGE_KEY = "notes:notebook-visuals:v1";
const POPULAR_PAGE_SIZE = 18;
const NOTES_REUSE_TEMPLATE_KEY = "fym_reuse_template_notes_v1";
/** 历史「导读」助手气泡 id 前缀；加载会话时剔除，避免旧数据占位 */
const NOTES_ASK_HINTS_BOOT_PREFIX = "__hints_boot__";

/** 无上传封面时，用稳定哈希为每个笔记本分配主题色与图标（热门列表等） */
function stableNotebookVisualFromKey(key: string): NotebookVisual {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return {
    themeIndex: u % NOTEBOOK_CARD_THEMES.length,
    iconIndex: Math.floor(u / NOTEBOOK_CARD_THEMES.length) % NOTEBOOK_ICONS.length
  };
}

function randomNotebookVisual(): NotebookVisual {
  return {
    themeIndex: Math.floor(Math.random() * NOTEBOOK_CARD_THEMES.length),
    iconIndex: Math.floor(Math.random() * NOTEBOOK_ICONS.length)
  };
}

function formatDisplayDate(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 卡片内日期：仅月日，无前缀文案 */
function formatNotebookCardMonthDay(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

type NotesHubDiscoverTab = "all" | "mine" | "popular";

type HubMineNotebookCardsProps = {
  notebooks: string[];
  notebookVisualByName: Record<string, NotebookVisual>;
  notebookMetaByName: Record<string, NotebookMeta>;
  notebookSharingByName: Record<string, NotebookSharingRow>;
  notebookCoverByName: Record<string, NotebookCoverMeta>;
  notebookCardMenu: string | null;
  setNotebookCardMenu: Dispatch<SetStateAction<string | null>>;
  onOpenNotebook: (nb: string) => void;
  onRequestNewNotebook: () => void;
  showNewTile: boolean;
  listClassName: string;
  onShareNotebook: (nb: string) => void;
  onRenameNotebook: (nb: string) => void;
  onDeleteNotebook: (nb: string) => void;
  onNotebookCoverSettings: (nb: string) => void;
};

function HubMineNotebookCards({
  notebooks,
  notebookVisualByName,
  notebookMetaByName,
  notebookSharingByName,
  notebookCoverByName,
  notebookCardMenu,
  setNotebookCardMenu,
  onOpenNotebook,
  onRequestNewNotebook,
  showNewTile,
  listClassName,
  onShareNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onNotebookCoverSettings
}: HubMineNotebookCardsProps) {
  return (
    <div className={listClassName}>
      {showNewTile ? (
        <button
          type="button"
          onClick={onRequestNewNotebook}
          className="flex min-h-[170px] min-w-[188px] max-w-[240px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/40 bg-fill/50 text-muted hover:bg-fill"
        >
          <span className="text-5xl font-light leading-none text-brand">+</span>
          <span className="mt-2 text-sm font-medium text-brand">新建笔记本</span>
        </button>
      ) : null}
      {notebooks.map((nb) => {
        const picked = notebookVisualByName[nb];
        const visual = {
          theme: NOTEBOOK_CARD_THEMES[picked?.themeIndex ?? 0],
          icon: NOTEBOOK_ICONS[picked?.iconIndex ?? 0]
        };
        const meta = notebookMetaByName[nb];
        const cov = notebookCoverByName[nb];
        const coverImg = notebookCoverImageUrl(nb, cov, "mine");
        const hasCoverLayer = Boolean(coverImg);
        const shareRow = notebookSharingByName[nb];
        const viewCount = typeof shareRow?.viewCount === "number" ? shareRow.viewCount : 0;
        const sourceN = meta?.sourceCount ?? 0;
        const shareLabel = shareRow?.isPublic ? "已分享" : "未分享";
        const summaryLine = `${formatNotebookCardMonthDay(meta?.createdAt)}|来源:${sourceN}|浏览:${viewCount}|${shareLabel}`;
        return (
          <div key={nb} className="flex min-w-[188px] max-w-[240px] shrink-0 flex-col">
            <div
              className={`relative flex min-h-[170px] min-w-[188px] max-w-[240px] flex-col overflow-hidden rounded-2xl border p-3 shadow-soft ${
                hasCoverLayer ? "border-line/80 bg-surface/95" : visual.theme.card
              }`}
            >
              {hasCoverLayer ? (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${coverImg})` }}
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 z-[1] bg-gradient-to-b from-white/90 via-white/82 to-white/94"
                  />
                </>
              ) : null}
              <div className="absolute right-2 top-2 z-[4]">
                <span className="relative flex" data-notebook-card-overflow-menu>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-muted hover:bg-fill"
                    aria-label="更多"
                    aria-expanded={notebookCardMenu === nb}
                    onClick={() => setNotebookCardMenu((x) => (x === nb ? null : nb))}
                  >
                    ⋯
                  </button>
                  {notebookCardMenu === nb ? (
                    <div className="absolute right-0 top-full z-20 mt-0.5 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onRenameNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onNotebookCoverSettings(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        上传封面
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                        onClick={() => {
                          onShareNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        分享
                      </button>
                      <button
                        type="button"
                        className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                        onClick={() => {
                          onDeleteNotebook(nb);
                          setNotebookCardMenu(null);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </span>
              </div>
              <button
                type="button"
                className="relative z-[2] flex min-h-0 flex-1 flex-col justify-start gap-2 pr-6 text-left"
                onClick={() => onOpenNotebook(nb)}
              >
                {!hasCoverLayer ? (
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base ${visual.theme.iconWrap}`}
                    aria-hidden
                  >
                    {visual.icon}
                  </span>
                ) : null}
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-ink">{nb}</p>
                </div>
                <p className="relative z-[2] mt-auto shrink-0 line-clamp-3 break-all text-[10px] leading-snug text-muted">
                  {summaryLine}
                </p>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type HubPopularNotebookGridProps = {
  popularLoading: boolean;
  popularItems: PopularNotebookItem[];
  onPick: (item: PopularNotebookItem) => void;
  className?: string;
  showLoadMore?: boolean;
  popularHasMore?: boolean;
  popularLoadingMore?: boolean;
  onPopularLoadMore?: () => void;
};

function HubPopularNotebookGrid({
  popularLoading,
  popularItems,
  onPick,
  className,
  showLoadMore,
  popularHasMore,
  popularLoadingMore,
  onPopularLoadMore
}: HubPopularNotebookGridProps) {
  return (
    <div className={className ?? ""}>
      {popularLoading ? <p className="py-8 text-center text-sm text-muted">加载中…</p> : null}
      {!popularLoading && popularItems.length === 0 ? (
        <EmptyState
          title="暂无热门分享"
          description="在分享中勾选「在热门笔记本中展示」，并保证至少 2 条来源且近一年有更新；满足门槛后按质量分排序。"
          className="mt-4 border-dashed border-line bg-fill/40 py-8"
        />
      ) : null}
      {!popularLoading ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {popularItems.map((item) => {
            const cov: NotebookCoverMeta = {
              coverMode: item.coverMode,
              coverPresetId: item.coverPresetId,
              hasUploadThumb: item.hasUploadThumb,
              autoCoverNoteId: item.autoCoverNoteId
            };
            const coverImg = notebookCoverImageUrl(item.notebook, cov, "popular", item.ownerUserId);
            const hasCoverLayer = Boolean(coverImg);
            const pv = stableNotebookVisualFromKey(`${item.ownerUserId}:${item.notebook}`);
            const pvis = {
              theme: NOTEBOOK_CARD_THEMES[pv.themeIndex],
              icon: NOTEBOOK_ICONS[pv.iconIndex]
            };
            const sourceN = typeof item.sourceCount === "number" ? item.sourceCount : 0;
            const accessLabel = item.publicAccess === "edit" ? "可创作" : "只读";
            const summaryLine = `${formatNotebookCardMonthDay(item.latestSourceAt)}|来源:${sourceN}|浏览量:${item.viewCount}|${accessLabel}`;
            return (
              <div
                key={`${item.ownerUserId}:${item.notebook}`}
                className="flex min-w-[188px] max-w-[240px] shrink-0 flex-col"
              >
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className={`relative flex min-h-[170px] min-w-[188px] max-w-[240px] flex-col justify-start gap-2 overflow-hidden rounded-2xl border p-3 text-left shadow-soft transition-colors hover:border-brand/40 hover:bg-fill/40 ${
                    hasCoverLayer ? "border-line/80 bg-surface/95" : pvis.theme.card
                  }`}
                >
                  {hasCoverLayer ? (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${coverImg})` }}
                      />
                      <div
                        aria-hidden
                        className="absolute inset-0 z-[1] bg-gradient-to-b from-white/90 via-white/82 to-white/94"
                      />
                    </>
                  ) : null}
                  <div className="relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col pr-1">
                    {!hasCoverLayer ? (
                      <span
                        className={`mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-lg ${pvis.theme.iconWrap}`}
                        aria-hidden
                      >
                        {pvis.icon}
                      </span>
                    ) : null}
                    <p className="line-clamp-2 text-xs font-semibold text-ink">{item.ownerDisplayName}</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{item.notebook}</p>
                  </div>
                  <p className="relative z-[2] mt-auto shrink-0 line-clamp-3 break-all pr-1 text-[10px] leading-snug text-muted">
                    {summaryLine}
                  </p>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {showLoadMore && !popularLoading && popularItems.length > 0 && popularHasMore ? (
        <div className="mt-4 flex justify-center pb-2">
          <button
            type="button"
            className="rounded-xl border border-line bg-fill/50 px-4 py-2 text-sm font-medium text-ink hover:bg-fill disabled:opacity-50"
            disabled={Boolean(popularLoadingMore)}
            onClick={() => onPopularLoadMore?.()}
          >
            {popularLoadingMore ? "加载中…" : "加载更多"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FreshNoteSparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 2l1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2z"
        fill="currentColor"
        opacity={0.88}
      />
      <path
        d="M19 14l.6 2.4L22 17l-2.4.6L19 20l-.6-2.4L16 17l2.4-.6L19 14z"
        fill="currentColor"
        opacity={0.5}
      />
    </svg>
  );
}

export default function NotesPage() {
  const { t } = useI18n();
  const { user, phone, getAuthHeaders, ready } = useAuth();
  /** 与 AuthProvider 中 userScopedStorage 同步；用于在切换账号时重载对话缓存 */
  const storageAccountScope = useMemo(() => accountKeyFromUser(user), [user]);
  const skipNotesAskSaveRef = useRef(true);
  const notesAskMessagesSnapshotRef = useRef<NotesAskTurn[]>([]);
  /** 对话持久化分区：笔记本作用域 + 选中笔记 ID（排序拼接），避免删笔记后同标题新笔记继承旧会话 */
  const prevNotesAskChatScopeRef = useRef<{ nb: string; idsKey: string; askSalt: string } | null>(null);
  const noteRefCap = useMemo(() => maxNotesForReference(), []);
  const createdByPhone = useMemo(() => {
    const uid = typeof user?.user_id === "string" ? user.user_id.trim() : "";
    if (uid) return uid;
    return String(user?.phone || user?.username || user?.email || phone || "").trim();
  }, [user?.user_id, user?.phone, user?.username, user?.email, phone]);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notebooks, setNotebooks] = useState<string[]>([]);
  /** 避免首屏 notebooks=[] 时误判为「用户没有任何笔记本」 */
  const [notebooksReady, setNotebooksReady] = useState(false);
  const [notebookVisualByName, setNotebookVisualByName] = useState<Record<string, NotebookVisual>>({});
  const [notebookMetaByName, setNotebookMetaByName] = useState<Record<string, NotebookMeta>>({});
  const [selectedNotebook, setSelectedNotebook] = useState("");
  const [hubView, setHubView] = useState(true);
  /** 用户主动回到笔记本卡片列表时为 true，避免再次自动进入工作台 */
  const userPrefersNotebookHubRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newNotebookName, setNewNotebookName] = useState("");
  const [notebookModalError, setNotebookModalError] = useState("");
  const [showNotebookModal, setShowNotebookModal] = useState(false);
  const [showRenameNotebook, setShowRenameNotebook] = useState(false);
  const [renameNotebookOld, setRenameNotebookOld] = useState("");
  const [renameNotebookNew, setRenameNotebookNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewKw, setPreviewKw] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewStatusLine, setPreviewStatusLine] = useState("");
  const [previewSourceType, setPreviewSourceType] = useState("");
  const [previewSourceUrl, setPreviewSourceUrl] = useState("");
  const [previewCreatedAt, setPreviewCreatedAt] = useState("");
  const [previewWordCount, setPreviewWordCount] = useState<number>(0);
  const [previewStage, setPreviewStage] = useState("");
  const [previewNextAction, setPreviewNextAction] = useState("");
  const [previewSimplified, setPreviewSimplified] = useState(false);
  const [previewHighlightHint, setPreviewHighlightHint] = useState("");
  const [worksPanelExpanded, setWorksPanelExpanded] = useState(false);
  const [renameNoteId, setRenameNoteId] = useState<string | null>(null);
  const [renameNoteTitle, setRenameNoteTitle] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importUrlError, setImportUrlError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const addNoteFileRef = useRef<HTMLInputElement | null>(null);
  const [deleteNotebookConfirm, setDeleteNotebookConfirm] = useState(false);
  const [deleteNotebookTarget, setDeleteNotebookTarget] = useState<string | null>(null);
  const [noteMenuOpenId, setNoteMenuOpenId] = useState<string | null>(null);
  const [notebookCardMenu, setNotebookCardMenu] = useState<string | null>(null);
  const [hubDiscoverTab, setHubDiscoverTab] = useState<NotesHubDiscoverTab>("all");
  const [hubAllMineExpanded, setHubAllMineExpanded] = useState(false);
  const [hubAllMineHasOverflow, setHubAllMineHasOverflow] = useState(false);
  const hubAllMineClipRef = useRef<HTMLDivElement | null>(null);
  const hubAllMineMeasureRef = useRef<HTMLDivElement | null>(null);
  const [popularItems, setPopularItems] = useState<PopularNotebookItem[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [popularLoadingMore, setPopularLoadingMore] = useState(false);
  const [popularHasMore, setPopularHasMore] = useState(false);
  const popularItemsLenRef = useRef(0);
  const [notebookSharingByName, setNotebookSharingByName] = useState<Record<string, NotebookSharingRow>>({});
  const [notebookCoversByName, setNotebookCoversByName] = useState<Record<string, NotebookCoverMeta>>({});
  const [showNotebookCoverModal, setShowNotebookCoverModal] = useState(false);
  const [notebookCoverModalTarget, setNotebookCoverModalTarget] = useState("");
  const [notebookCoverModalBusy, setNotebookCoverModalBusy] = useState(false);
  const [notebookCoverModalErr, setNotebookCoverModalErr] = useState("");
  const notebookCoverFileRef = useRef<HTMLInputElement | null>(null);
  const [sharedBrowse, setSharedBrowse] = useState<SharedBrowseContext | null>(null);
  const [showShareNotebookModal, setShowShareNotebookModal] = useState(false);
  const [shareTargetNotebook, setShareTargetNotebook] = useState("");
  const [shareFormAccess, setShareFormAccess] = useState<"read_only" | "edit">("read_only");
  const [shareModalBusy, setShareModalBusy] = useState(false);
  const [shareModalError, setShareModalError] = useState("");
  const [shareCopyHint, setShareCopyHint] = useState("");
  const shareViewedKeyRef = useRef("");
  const shareLinkHydratedRef = useRef(false);

  const buildNotebookShareUrl = useCallback((notebookName: string, ownerUserId: string, access: "read_only" | "edit") => {
    if (typeof window === "undefined") return "";
    const u = new URL(`${window.location.origin}/notes`);
    u.searchParams.set("notebook", notebookName);
    u.searchParams.set("sharedFromOwnerUserId", ownerUserId);
    u.searchParams.set("shareAccess", access);
    return u.toString();
  }, []);

  const copyNotebookShareLink = useCallback(async () => {
    const uid = typeof user?.user_id === "string" ? user.user_id.trim() : "";
    const nb = shareTargetNotebook.trim();
    if (!uid || !nb) return;
    if (!notebookSharingByName[nb]?.isPublic) return;
    const url = buildNotebookShareUrl(nb, uid, shareFormAccess);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopyHint("已复制到剪贴板");
      window.setTimeout(() => setShareCopyHint(""), 2200);
    } catch {
      setShareCopyHint("复制失败，请手动复制浏览器地址栏链接");
      window.setTimeout(() => setShareCopyHint(""), 3500);
    }
  }, [buildNotebookShareUrl, notebookSharingByName, shareFormAccess, shareTargetNotebook, user?.user_id]);

  /** 仅用 Escape：不在 document 上监听 pointerdown，避免与侧栏导航同一事件管线冲突。 */
  useEffect(() => {
    if (!notebookCardMenu && !noteMenuOpenId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setNotebookCardMenu(null);
      setNoteMenuOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notebookCardMenu, noteMenuOpenId]);

  /** 仅在主内容 <main> 上冒泡关闭溢出菜单；点击侧栏时事件不会进入 main，故不会触发 setState。 */
  const onNotesMainPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (notebookCardMenu && !t.closest("[data-notebook-card-overflow-menu]")) {
        setNotebookCardMenu(null);
      }
      if (noteMenuOpenId && !t.closest("[data-note-overflow-menu]")) {
        setNoteMenuOpenId(null);
      }
    },
    [notebookCardMenu, noteMenuOpenId]
  );

  const [draftSelectedNoteIds, setDraftSelectedNoteIds] = useState<string[]>([]);
  const draftNotesAskIdsKey = useMemo(
    () => [...draftSelectedNoteIds].filter(Boolean).sort().join("|"),
    [draftSelectedNoteIds]
  );
  /** loadNotes 内校验「已删除的笔记 id」：避免 localStorage 里残留旧 id 导致仍加载旧对话 */
  const draftSelectedNoteIdsRef = useRef<string[]>([]);
  useEffect(() => {
    draftSelectedNoteIdsRef.current = draftSelectedNoteIds;
  }, [draftSelectedNoteIds]);

  useEffect(() => {
    setDraftSelectedNoteIds((prev) => (prev.length > noteRefCap ? prev.slice(0, noteRefCap) : prev));
  }, [noteRefCap]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [articleDraftPreview, setArticleDraftPreview] = useState<{ jobId: string; title: string; body: string } | null>(
    null
  );
  const [podcastGenBusy, setPodcastGenBusy] = useState(false);
  const [podcastGenMessage, setPodcastGenMessage] = useState("");
  const [podcastPendingStudioWork, setPodcastPendingStudioWork] = useState<WorkItem | null>(null);
  const [notePage, setNotePage] = useState(1);
  const [hasMoreNotes, setHasMoreNotes] = useState(false);
  const [freshNoteIds, setFreshNoteIds] = useState<string[]>([]);
  const freshNoteTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [showPodcastGenreModal, setShowPodcastGenreModal] = useState(false);
  const [podcastRoomPresetKey, setPodcastRoomPresetKey] = useState<PodcastRoomPresetKey>("custom");
  const [showPodcastRoomModal, setShowPodcastRoomModal] = useState(false);

  const [showArticleModal, setShowArticleModal] = useState(false);
  const [articleModalStep, setArticleModalStep] = useState<"pick" | "form">("pick");
  const [artKind, setArtKind] = useState<ArtKindKey>("custom");
  const [artLang, setArtLang] = useState("中文");
  const [artChars, setArtChars] = useState(NOTES_ART_TARGET_CHARS_DEFAULT);
  const [artCharsInput, setArtCharsInput] = useState(String(NOTES_ART_TARGET_CHARS_DEFAULT));
  const [artText, setArtText] = useState("");
  const [artCoreQuestion, setArtCoreQuestion] = useState("");
  /** 右侧资料区底部输入：带入播客/文章，不在此自动扩写全文 */
  const [notesStudioPrompt, setNotesStudioPrompt] = useState("");
  const [notesAskQuestion, setNotesAskQuestion] = useState("");
  const [notesAskMessages, setNotesAskMessages] = useState<NotesAskTurn[]>([]);
  const [notesAskBusy, setNotesAskBusy] = useState(false);
  /** 本页有效、默认关，不跨路由持久化（离开笔记页即丢失） */
  const [notesAskStreamInfo, setNotesAskStreamInfo] = useState("");
  const notesAskStreamInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notesAskError, setNotesAskError] = useState("");
  const notesAskScrollRef = useRef<HTMLDivElement | null>(null);
  const notesAskTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 当前向资料提问的 fetch；用于「停止生成」 */
  const notesAskStreamAbortRef = useRef<AbortController | null>(null);
  const [notesAskNoteBusyId, setNotesAskNoteBusyId] = useState<string | null>(null);
  const [notesAskDebugClient, setNotesAskDebugClient] = useState(false);
  const [notesAskDebugCopied, setNotesAskDebugCopied] = useState<"" | "stream" | "curlStream">("");
  const [sourcesPanelCollapsed, setSourcesPanelCollapsed] = useState(false);
  /** 与 AppShell 左侧主导航（首页 / 知识库 / 创作等）折叠状态同步 */
  const [appNavCollapsed, setAppNavCollapsed] = useState(false);

  useEffect(() => {
    function syncAppNavCollapsedFromStorage() {
      try {
        const v = readLocalStorageScoped(APP_SIDEBAR_COLLAPSED_KEY);
        setAppNavCollapsed(v === SIDEBAR_COLLAPSED_STORAGE);
      } catch {
        setAppNavCollapsed(false);
      }
    }
    syncAppNavCollapsedFromStorage();
    window.addEventListener(APP_SIDEBAR_TOGGLE_EVENT, syncAppNavCollapsedFromStorage);
    window.addEventListener(APP_SIDEBAR_COLLAPSE_EVENT, syncAppNavCollapsedFromStorage);
    window.addEventListener("storage", syncAppNavCollapsedFromStorage);
    return () => {
      window.removeEventListener(APP_SIDEBAR_TOGGLE_EVENT, syncAppNavCollapsedFromStorage);
      window.removeEventListener(APP_SIDEBAR_COLLAPSE_EVENT, syncAppNavCollapsedFromStorage);
      window.removeEventListener("storage", syncAppNavCollapsedFromStorage);
    };
  }, [storageAccountScope]);

  useEffect(() => {
    if (!NOTES_ASK_DEBUG_BODY_ENABLED) return;
    setNotesAskDebugClient(true);
  }, []);

  useEffect(() => {
    setArtCharsInput(String(artChars));
  }, [artChars]);

  const [podcastWorks, setPodcastWorks] = useState<WorkItem[]>([]);
  const [podcastWorksLoading, setPodcastWorksLoading] = useState(true);
  const [podcastWorksError, setPodcastWorksError] = useState("");
  const podcastEventSourceRef = useRef<EventSource | null>(null);
  const podcastResolveWaitRef = useRef<(() => void) | null>(null);
  const podcastQueueStallTimerRef = useRef<number | null>(null);
  const podcastCancelledRef = useRef(false);
  const podcastRecoveryStartedRef = useRef(false);
  const podcastActiveJobIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  /** 来自 /notes?note=<id> 深链：解析笔记本并滚动到对应卡片 */
  const pendingFocusNoteIdRef = useRef<string | null>(null);
  /** 与「来源」持久化配合：仅在当前笔记本已做过一次恢复后再写入，避免切换瞬间用旧笔记本的勾选覆盖新键 */
  const draftSourcesPersistNotebookRef = useRef<string>("");
  const activeDraftJobIdRef = useRef<string | null>(null);
  const resolveDraftWaitRef = useRef<(() => void) | null>(null);
  const draftCancelledRef = useRef(false);
  const draftRecoveryStartedRef = useRef(false);

  const stats = useMemo(() => ({ total: notes.length }), [notes.length]);

  const effectiveDraftNotebookKey = useMemo(() => {
    const nb = selectedNotebook.trim();
    if (!nb) return "";
    if (sharedBrowse) return `shared:${sharedBrowse.ownerUserId}:${nb}`;
    return nb;
  }, [selectedNotebook, sharedBrowse]);

  /** 与 notesAskChatStorage v3 对齐：共享笔记本仅靠 scoped 路径区分，自有笔记本用 instanceId 或最早笔记时间 */
  const notesAskChatScopeSalt = useMemo(() => {
    const key = effectiveDraftNotebookKey.trim();
    if (!key) return "0";
    if (key.startsWith("shared:")) return "0";
    const name = selectedNotebook.trim();
    const m = notebookMetaByName[name];
    const s = (m?.instanceId || m?.createdAt || "0").trim();
    return s || "0";
  }, [effectiveDraftNotebookKey, selectedNotebook, notebookMetaByName]);

  /** 对话列表中时间顺序上最后一条用户消息，用于复制 / 编辑 / 打断后回填 */
  const notesAskLastUserMessageId = useMemo(() => {
    for (let i = notesAskMessages.length - 1; i >= 0; i--) {
      const row = notesAskMessages[i];
      if (row?.role === "user") return row.id;
    }
    return null;
  }, [notesAskMessages]);

  const beginEditNotesAskUserTurn = useCallback((userTurnId: string, text: string) => {
    notesAskStreamAbortRef.current?.abort();
    setNotesAskQuestion(text);
    setNotesAskError("");
    setNotesAskMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === userTurnId);
      if (idx < 0) return prev;
      return prev.slice(0, idx);
    });
    window.setTimeout(() => notesAskTextareaRef.current?.focus(), 0);
  }, []);

  const markNoteAsFresh = useCallback((noteId: string) => {
    const id = noteId.trim();
    if (!id) return;
    setFreshNoteIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    const existing = freshNoteTimeoutsRef.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setFreshNoteIds((prev) => prev.filter((x) => x !== id));
      freshNoteTimeoutsRef.current.delete(id);
    }, 15 * 60 * 1000);
    freshNoteTimeoutsRef.current.set(id, t);
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of freshNoteTimeoutsRef.current.values()) clearTimeout(timer);
      freshNoteTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const el = notesAskScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [notesAskMessages]);

  useEffect(() => {
    notesAskMessagesSnapshotRef.current = notesAskMessages;
  }, [notesAskMessages]);

  useEffect(() => {
    return () => {
      if (notesAskStreamInfoTimerRef.current) clearTimeout(notesAskStreamInfoTimerRef.current);
    };
  }, []);

  const notesAskDebugPack = useMemo(() => {
    const nb = selectedNotebook.trim();
    const idsStream = [...draftSelectedNoteIds];
    const q = notesAskQuestion.trim();
    const owner = (sharedBrowse?.ownerUserId || "").trim();
    const streamBody: Record<string, unknown> = {
      notebook: nb,
      note_ids: idsStream,
      question: q
    };
    if (owner) streamBody.sharedFromOwnerUserId = owner;
    const streamJsonOne = JSON.stringify(streamBody);
    return {
      streamJsonPretty: JSON.stringify(streamBody, null, 2),
      streamJsonOne,
      streamReady: Boolean(nb && idsStream.length && q)
    };
  }, [
    selectedNotebook,
    draftSelectedNoteIds,
    notesAskQuestion,
    sharedBrowse?.ownerUserId
  ]);

  const notesAskDebugCurls = useMemo(() => {
    if (!notesAskDebugClient || typeof window === "undefined") {
      return { streamUrl: "", streamCurl: "" };
    }
    const auth = getAuthHeaders();
    const streamUrl = notesAskResolveRequestUrl("/api/notes/ask/stream");
    return {
      streamUrl,
      streamCurl: streamUrl ? buildNotesAskCurlCommand(streamUrl, notesAskDebugPack.streamJsonOne, auth) : ""
    };
  }, [notesAskDebugClient, notesAskDebugPack.streamJsonOne, getAuthHeaders]);

  const copyNotesAskDebug = useCallback(async (text: string, kind: "stream" | "curlStream") => {
    try {
      await navigator.clipboard.writeText(text);
      setNotesAskDebugCopied(kind);
      window.setTimeout(() => setNotesAskDebugCopied(""), 1800);
    } catch {
      // 拒绝剪贴板权限时静默
    }
  }, []);

  useEffect(() => {
    const nb = effectiveDraftNotebookKey.trim();
    const idsKey = draftNotesAskIdsKey;
    const prev = prevNotesAskChatScopeRef.current;
    const askSalt = notesAskChatScopeSalt;
    if (prev && (prev.nb !== nb || prev.idsKey !== idsKey || prev.askSalt !== askSalt)) {
      const snap = notesAskMessagesSnapshotRef.current;
      if (!snap.some((m) => m.streaming)) {
        const prevIds = prev.idsKey ? prev.idsKey.split("|").filter(Boolean) : [];
        if (prev.nb) saveNotesAskChat(prev.nb, prevIds, snap, prev.askSalt);
      }
    }
    prevNotesAskChatScopeRef.current = { nb, idsKey, askSalt };

    if (!nb) {
      notesAskClientLog("debug", "persist", "chat_cleared_no_notebook");
      setNotesAskMessages([]);
      skipNotesAskSaveRef.current = true;
      return;
    }
    const loaded = loadNotesAskChat(nb, draftSelectedNoteIds, askSalt);
    notesAskClientLog("info", "persist", "chat_scope_loaded", {
      nb,
      idsKey,
      messageCount: loaded?.length ?? 0
    });
    setNotesAskMessages(
      loaded?.length
        ? loaded
            .filter((m) => !m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX))
            .map((m) => ({
              ...m,
              streaming: false as boolean | undefined,
              hintSuggestions: m.hintSuggestions?.length ? [...m.hintSuggestions] : undefined
            }))
        : []
    );
    skipNotesAskSaveRef.current = true;
  }, [
    effectiveDraftNotebookKey,
    draftNotesAskIdsKey,
    draftSelectedNoteIds,
    notesAskChatScopeSalt,
    storageAccountScope
  ]);

  useEffect(() => {
    if (skipNotesAskSaveRef.current) {
      skipNotesAskSaveRef.current = false;
      return;
    }
    const nb = effectiveDraftNotebookKey.trim();
    if (!nb) return;
    if (notesAskMessages.some((m) => m.streaming)) return;
    const timer = window.setTimeout(() => {
      saveNotesAskChat(nb, draftSelectedNoteIds, notesAskMessages, notesAskChatScopeSalt);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [notesAskMessages, effectiveDraftNotebookKey, draftSelectedNoteIds, notesAskChatScopeSalt, storageAccountScope]);

  const notesAskUnloadRef = useRef({
    messages: [] as NotesAskTurn[],
    nb: "",
    idsKey: "",
    askSalt: "0"
  });
  useEffect(() => {
    notesAskUnloadRef.current = {
      messages: notesAskMessages,
      nb: effectiveDraftNotebookKey.trim(),
      idsKey: draftNotesAskIdsKey,
      askSalt: notesAskChatScopeSalt
    };
  }, [notesAskMessages, effectiveDraftNotebookKey, draftNotesAskIdsKey, notesAskChatScopeSalt]);

  useEffect(() => {
    const onHide = () => {
      const { messages, nb, idsKey, askSalt } = notesAskUnloadRef.current;
      if (!nb) return;
      if (messages.some((m) => m.streaming)) {
        notesAskClientLog("debug", "persist", "pagehide_skip_streaming");
        return;
      }
      const ids = idsKey ? idsKey.split("|").filter(Boolean) : [];
      notesAskClientLog("debug", "persist", "pagehide_save", {
        nb,
        idsKey,
        messageCount: messages.length
      });
      saveNotesAskChat(nb, ids, messages, askSalt);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const notesSorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return tb - ta;
    });
  }, [notes]);
  const notesById = useMemo(() => {
    const m = new Map<string, NoteItem>();
    for (const n of notes) m.set(n.noteId, n);
    return m;
  }, [notes]);

  const selectAllOnPageInputRef = useRef<HTMLInputElement>(null);
  const selectableNoteIdsOnPage = useMemo(
    () =>
      notesSorted
        .filter((n) => isSourceUsable(n))
        .map((n) => n.noteId),
    [notesSorted]
  );
  const allNotesOnPageSelected =
    selectableNoteIdsOnPage.length > 0 &&
    selectableNoteIdsOnPage.every((id) => draftSelectedNoteIds.includes(id));
  const someNotesOnPageSelected = selectableNoteIdsOnPage.some((id) => draftSelectedNoteIds.includes(id));

  useLayoutEffect(() => {
    const el = selectAllOnPageInputRef.current;
    if (el) el.indeterminate = someNotesOnPageSelected && !allNotesOnPageSelected;
  }, [allNotesOnPageSelected, someNotesOnPageSelected]);

  const noteTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of notes) {
      m[n.noteId] = n.title || n.noteId;
    }
    return m;
  }, [notes]);

  const buildPodcastPendingStudioWork = useCallback(
    (jobId: string, status: "queued" | "running"): WorkItem => {
      const nb = selectedNotebook.trim();
      const titles = draftSelectedNoteIds
        .map((nid) => {
          const hit = notes.find((n) => n.noteId === nid);
          return String(hit?.title || "").trim();
        })
        .filter(Boolean);
      return {
        id: jobId,
        type: "podcast_generate",
        projectName: NOTES_PODCAST_PROJECT_NAME,
        status,
        notesSourceNotebook: nb || undefined,
        notesSourceNoteCount: draftSelectedNoteIds.length,
        notesSourceTitles: titles.length ? titles : undefined,
        createdAt: new Date().toISOString()
      };
    },
    [selectedNotebook, draftSelectedNoteIds, notes]
  );

  /** 与 orchestrator list_notebooks 排序一致（zh-CN 字典序） */
  const mergeNotebookName = useCallback((list: string[], name: string) => {
    return [...new Set([...list, name])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, []);

  const loadNotebooks = useCallback(async () => {
    try {
      const res = await fetch("/api/notebooks", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json()) as {
        success?: boolean;
        notebooks?: string[];
        notebookSharing?: Record<string, NotebookSharingRow>;
        notebookCovers?: Record<string, NotebookCoverMeta>;
      };
      if (res.ok && data.success && Array.isArray(data.notebooks)) {
        setNotebooks(data.notebooks);
      }
      if (res.ok && data.success && data.notebookSharing && typeof data.notebookSharing === "object") {
        setNotebookSharingByName(data.notebookSharing);
      }
      if (res.ok && data.success && data.notebookCovers && typeof data.notebookCovers === "object") {
        setNotebookCoversByName(data.notebookCovers);
      }
    } catch {
      // ignore
    } finally {
      setNotebooksReady(true);
    }
  }, [getAuthHeaders]);

  const loadPopularNotebooks = useCallback(
    async (append: boolean) => {
      if (append) {
        setPopularLoadingMore(true);
      } else {
        setPopularLoading(true);
      }
      try {
        const limit = POPULAR_PAGE_SIZE;
        const offset = append ? popularItemsLenRef.current : 0;
        const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        const res = await fetch(`/api/notebooks/popular?${q.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          items?: PopularNotebookItem[];
          has_more?: boolean;
        };
        if (res.ok && data.success && Array.isArray(data.items)) {
          setPopularItems((prev) => (append ? [...prev, ...data.items!] : data.items!));
          setPopularHasMore(Boolean(data.has_more));
        } else if (!append) {
          setPopularHasMore(false);
        }
      } catch {
        // ignore
      } finally {
        if (append) {
          setPopularLoadingMore(false);
        } else {
          setPopularLoading(false);
        }
      }
    },
    [getAuthHeaders]
  );

  useEffect(() => {
    popularItemsLenRef.current = popularItems.length;
  }, [popularItems.length]);

  const loadNotebookMeta = useCallback(async () => {
    try {
      const map: Record<string, NotebookMeta> = {};
      let offset = 0;
      let shouldContinue = true;
      while (shouldContinue) {
        const q = new URLSearchParams({
          limit: String(NOTEBOOK_STATS_PAGE),
          offset: String(offset)
        });
        const res = await fetch(`/api/notes?${q.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as NotesResp & { detail?: unknown };
        if (!res.ok || !data.success || !Array.isArray(data.notes)) break;
        for (const note of data.notes) {
          const name = String(note.notebook || "").trim();
          if (!name) continue;
          if (!map[name]) {
            map[name] = { noteCount: 0, sourceCount: 0, createdAt: "" };
          }
          map[name].noteCount += 1;
          map[name].sourceCount += 1;
          const createdTs = Date.parse(String(note.createdAt || ""));
          if (!Number.isNaN(createdTs)) {
            const currentTs = Date.parse(String(map[name].createdAt || ""));
            if (Number.isNaN(currentTs) || createdTs < currentTs) {
              map[name].createdAt = String(note.createdAt || "");
            }
          }
        }
        if (data.has_more) {
          offset += NOTEBOOK_STATS_PAGE;
        } else {
          shouldContinue = false;
        }
      }
      setNotebookMetaByName((prev) => {
        const merged: Record<string, NotebookMeta> = {};
        for (const [name, meta] of Object.entries(map)) {
          const prevM = prev[name];
          merged[name] = {
            ...meta,
            ...(prevM?.instanceId ? { instanceId: prevM.instanceId } : {})
          };
        }
        for (const [name, meta] of Object.entries(prev)) {
          if (!merged[name]) merged[name] = meta;
        }
        return merged;
      });
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  /**
   * 回到笔记本列表或侧栏「知识库」入口时：关闭会盖住 hub 卡片的弹层，避免误触侧栏其它入口、或以为「笔记本点不动」。
   */
  const dismissNotesBlockingOverlays = useCallback(() => {
    setShowPodcastGenreModal(false);
    setShowPodcastRoomModal(false);
    setShowArticleModal(false);
    setArticleModalStep("pick");
    setShowAddNoteModal(false);
    setShowShareNotebookModal(false);
    setShareModalError("");
    setShowNotebookModal(false);
    setNotebookModalError("");
    setNewNotebookName("");
    setShowRenameNotebook(false);
    setDeleteNotebookConfirm(false);
    setDeleteNotebookTarget(null);
    setNotebookCardMenu(null);
    setNoteMenuOpenId(null);
    setRenameNoteId(null);
    setPreviewOpen(false);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    if (shareLinkHydratedRef.current) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const nb = String(sp.get("notebook") || "").trim();
      const owner = String(sp.get("sharedFromOwnerUserId") || "").trim();
      if (!nb || !owner) return;
      shareLinkHydratedRef.current = true;
      const accRaw = String(sp.get("shareAccess") || "read_only").trim().toLowerCase();
      const acc: "read_only" | "edit" = accRaw === "edit" ? "edit" : "read_only";
      const loggedIn = Boolean(
        (typeof user?.user_id === "string" && user.user_id.trim()) ||
          String(user?.phone || user?.username || user?.email || phone || "").trim()
      );
      const effectiveAcc: "read_only" | "edit" = loggedIn ? acc : "read_only";
      setSelectedNotebook(nb);
      setSharedBrowse({ ownerUserId: owner, access: effectiveAcc });
      setHubView(false);
      userPrefersNotebookHubRef.current = false;
    } catch {
      // ignore
    }
  }, [ready, user, phone]);

  useEffect(() => {
    if (!ready || typeof window === "undefined" || !user) return;
    try {
      if (String(new URLSearchParams(window.location.search).get("shareAccess") || "").trim().toLowerCase() !== "edit")
        return;
      setSharedBrowse((prev) => {
        if (!prev || prev.access !== "read_only") return prev;
        return { ...prev, access: "edit" };
      });
    } catch {
      // ignore
    }
  }, [ready, user]);

  useEffect(() => {
    if (!notebooksReady) return;
    if (sharedBrowse) return;
    if (notebooks.length === 0) {
      setSelectedNotebook("");
      setHubView(false);
      return;
    }
    if (selectedNotebook && !notebooks.includes(selectedNotebook)) {
      userPrefersNotebookHubRef.current = true;
      setSelectedNotebook(notebooks[0] ?? "");
      setHubView(true);
    }
  }, [notebooks, selectedNotebook, notebooksReady, sharedBrowse]);

  useEffect(() => {
    if (!hubView || hubDiscoverTab === "mine") return;
    void loadPopularNotebooks(false);
  }, [hubView, hubDiscoverTab, loadPopularNotebooks]);

  useEffect(() => {
    if (hubDiscoverTab !== "all") setHubAllMineExpanded(false);
  }, [hubDiscoverTab]);

  useLayoutEffect(() => {
    if (hubDiscoverTab !== "all" || hubAllMineExpanded || !hubView) {
      setHubAllMineHasOverflow(false);
      return;
    }
    const clip = hubAllMineClipRef.current;
    const inner = hubAllMineMeasureRef.current;
    if (!clip || !inner) return;
    const sync = () => {
      setHubAllMineHasOverflow(inner.scrollHeight > clip.clientHeight + 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(clip);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [hubDiscoverTab, hubAllMineExpanded, hubView, notebooks]);

  /** 「我的」⋯ 菜单挂在卡片上；切到「热门」后 DOM 消失但 state 可能仍非空。 */
  useEffect(() => {
    setNotebookCardMenu(null);
  }, [hubDiscoverTab]);

  /** 回到笔记本列表页时清掉工作台遗留的笔记 ⋯ 菜单状态。 */
  useEffect(() => {
    if (!hubView) return;
    setNotebookCardMenu(null);
    setNoteMenuOpenId(null);
  }, [hubView]);

  useEffect(() => {
    const onNavHub = () => {
      userPrefersNotebookHubRef.current = true;
      setSharedBrowse(null);
      setHubView(true);
      setError("");
      dismissNotesBlockingOverlays();
    };
    window.addEventListener(NOTES_NAV_HUB_EVENT, onNavHub);
    return () => window.removeEventListener(NOTES_NAV_HUB_EVENT, onNavHub);
  }, [dismissNotesBlockingOverlays]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let changed = false;
    let nextMap: Record<string, NotebookVisual> = {};
    try {
      const cached = readLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, NotebookVisual>;
        if (parsed && typeof parsed === "object") nextMap = { ...parsed };
      }
    } catch {
      // ignore
    }
    for (const nb of notebooks) {
      if (!nextMap[nb]) {
        nextMap[nb] = randomNotebookVisual();
        changed = true;
      }
    }
    const allowed = new Set(notebooks);
    for (const key of Object.keys(nextMap)) {
      if (!allowed.has(key)) {
        delete nextMap[key];
        changed = true;
      }
    }
    setNotebookVisualByName(nextMap);
    if (changed) {
      try {
        writeLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(nextMap));
      } catch {
        // ignore
      }
    }
  }, [notebooks]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedNotebook) params.set("notebook", selectedNotebook);
      params.set("limit", String(NOTE_PAGE));
      params.set("offset", String((notePage - 1) * NOTE_PAGE));
      if (sharedBrowse?.ownerUserId) {
        params.set("sharedFromOwnerUserId", sharedBrowse.ownerUserId);
      }
      const q = params.toString();
      const res = await fetch(`/api/notes?${q}`, { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as NotesResp & { detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, `加载失败 ${res.status}`));
      const list = data.notes || [];
      let validIdSet = new Set(list.map((n) => n.noteId));
      const drafts = draftSelectedNoteIdsRef.current;
      const looksStale = drafts.some((id) => !validIdSet.has(id));
      if (looksStale && data.has_more) {
        try {
          const p2 = new URLSearchParams();
          if (selectedNotebook) p2.set("notebook", selectedNotebook);
          p2.set("limit", "500");
          p2.set("offset", "0");
          if (sharedBrowse?.ownerUserId) p2.set("sharedFromOwnerUserId", sharedBrowse.ownerUserId);
          const res2 = await fetch(`/api/notes?${p2.toString()}`, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { ...getAuthHeaders() }
          });
          const data2 = (await res2.json().catch(() => ({}))) as NotesResp;
          if (res2.ok && data2.success && Array.isArray(data2.notes)) {
            validIdSet = new Set(data2.notes.map((n) => n.noteId));
          }
        } catch {
          // 仅按当前页结果继续剔除
        }
      }
      if (drafts.length) {
        const pruned = drafts.filter((id) => validIdSet.has(id));
        if (pruned.length !== drafts.length) {
          setDraftSelectedNoteIds(pruned);
        }
      }
      setNotes(list);
      setHasMoreNotes(Boolean(data.has_more));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [selectedNotebook, notePage, getAuthHeaders, sharedBrowse]);

  useEffect(() => {
    setNotePage(1);
  }, [selectedNotebook, sharedBrowse]);

  useEffect(() => {
    void loadNotebooks();
    void loadNotebookMeta();
  }, [loadNotebookMeta, loadNotebooks]);

  useEffect(() => {
    try {
      const raw = readSessionStorageScoped(NOTES_REUSE_TEMPLATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        notes_notebook?: string;
        text?: string;
        script_language?: string;
        script_target_chars?: number;
      };
      const nb = String(parsed.notes_notebook || "").trim();
      if (nb) {
        setSelectedNotebook(nb);
        setHubView(false);
      }
      const txt = String(parsed.text || "").trim();
      if (txt) setArtText(txt);
      const lang = String(parsed.script_language || "").trim();
      if (lang) setArtLang(lang);
      const chars = Number(parsed.script_target_chars || 0);
      if (Number.isFinite(chars) && chars >= NOTES_ART_TARGET_CHARS_MIN && chars <= NOTES_ART_TARGET_CHARS_MAX) {
        setArtChars(Math.round(chars));
        setArtCharsInput(String(Math.round(chars)));
      }
      setArtKind("custom");
      setArticleModalStep("form");
      setShowArticleModal(true);
      removeSessionStorageScoped(NOTES_REUSE_TEMPLATE_KEY);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const nid = params.get("note");
      if (!nid) return;
      pendingFocusNoteIdRef.current = nid;
      void (async () => {
        try {
          const res = await fetch("/api/notes?limit=500", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
          const data = (await res.json().catch(() => ({}))) as NotesResp;
          if (!res.ok || !data.success || !Array.isArray(data.notes)) return;
          const hit = data.notes.find((x) => x.noteId === nid);
          if (!hit) return;
          setSelectedNotebook(String(hit.notebook || "").trim());
          setHubView(false);
        } catch {
          // ignore
        }
      })();
    } catch {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    const nid = pendingFocusNoteIdRef.current;
    if (!nid || hubView || loading) return;
    const found = notes.some((n) => n.noteId === nid);
    if (!found) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-note-id="${CSS.escape(nid)}"]`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      pendingFocusNoteIdRef.current = null;
      try {
        window.history.replaceState(null, "", "/notes");
      } catch {
        // ignore
      }
    });
  }, [hubView, loading, notes]);

  useEffect(() => {
    if (!hubView && selectedNotebook.trim()) void loadNotes();
  }, [loadNotes, hubView, selectedNotebook]);

  useEffect(() => {
    if (!notebooksReady) return;
    if (!hubView && !selectedNotebook.trim() && notebooks.length > 0) {
      setHubView(true);
    }
  }, [hubView, selectedNotebook, notebooks.length, notebooksReady]);

  useEffect(() => {
    const nb = effectiveDraftNotebookKey.trim();
    if (!nb) {
      setDraftSelectedNoteIds([]);
      draftSourcesPersistNotebookRef.current = "";
      return;
    }
    const prevNb = draftSourcesPersistNotebookRef.current;
    if (prevNb !== nb) {
      draftSourcesPersistNotebookRef.current = nb;
      setDraftSelectedNoteIds(readDraftSourceIdsForNotebook(nb, noteRefCap));
      return;
    }
    writeDraftSourceIdsForNotebook(nb, draftSelectedNoteIds, noteRefCap);
  }, [effectiveDraftNotebookKey, draftSelectedNoteIds, noteRefCap]);

  const fetchPodcastWorks = useCallback(async () => {
    setPodcastWorksError("");
    try {
      const res = await fetch("/api/works?limit=80&offset=0", { credentials: "same-origin", cache: "no-store", headers: { ...getAuthHeaders() } });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        ai?: WorkItem[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
      setPodcastWorks(Array.isArray(data.ai) ? data.ai : []);
    } catch (e) {
      setPodcastWorksError(String(e instanceof Error ? e.message : e));
      setPodcastWorks([]);
    } finally {
      setPodcastWorksLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void fetchPodcastWorks();
  }, [fetchPodcastWorks]);

  const clearPodcastQueueStallHintTimer = useCallback(() => {
    const tid = podcastQueueStallTimerRef.current;
    if (tid != null) {
      window.clearTimeout(tid);
      podcastQueueStallTimerRef.current = null;
    }
  }, []);

  const waitPodcastJobEvents = useCallback(
    (jobId: string): Promise<void> => {
      return new Promise((resolve) => {
        clearPodcastQueueStallHintTimer();
        podcastResolveWaitRef.current = resolve;
        podcastQueueStallTimerRef.current = window.setTimeout(() => {
          podcastQueueStallTimerRef.current = null;
          if (podcastActiveJobIdRef.current === jobId && podcastResolveWaitRef.current) {
            setPodcastGenMessage(t("podcast.studio.queueStallHint"));
          }
        }, MEDIA_QUEUE_STALL_HINT_MS);
        const es = new EventSource(jobEventsSourceUrl(jobId, 0));
        podcastEventSourceRef.current = es;
        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data) as {
              type?: string;
              message?: string;
              payload?: { progress?: number };
            };
            if (data.type === "terminal") {
              clearPodcastQueueStallHintTimer();
              es.close();
              podcastEventSourceRef.current = null;
              podcastResolveWaitRef.current = null;
              resolve();
              return;
            }
            if (isJobEventLogOnlyForUi(data.type)) {
              return;
            }
            const msg = String(data.message || "").trim();
            if (msg) {
              setPodcastGenMessage(presentJobProgressMessageForUser(msg));
              setPodcastPendingStudioWork((prev) =>
                prev && prev.id === jobId ? { ...prev, status: "running" } : prev
              );
            }
          } catch {
            // ignore
          }
        };
        es.onerror = () => {
          clearPodcastQueueStallHintTimer();
          setPodcastGenMessage("连接暂时中断，请到侧栏「创作记录」查看这一条的状态。");
          es.close();
          podcastEventSourceRef.current = null;
          podcastResolveWaitRef.current = null;
          resolve();
        };
      });
    },
    [clearPodcastQueueStallHintTimer, t]
  );

  useEffect(() => {
    return () => {
      clearPodcastQueueStallHintTimer();
      try {
        podcastEventSourceRef.current?.close();
      } catch {
        /* ignore */
      }
      podcastEventSourceRef.current = null;
      podcastResolveWaitRef.current?.();
      podcastResolveWaitRef.current = null;
      try {
        eventSourceRef.current?.close();
      } catch {
        /* ignore */
      }
      eventSourceRef.current = null;
      resolveDraftWaitRef.current?.();
      resolveDraftWaitRef.current = null;
    };
  }, [clearPodcastQueueStallHintTimer]);

  const finalizePodcastJob = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const terminal = (await fetch(`/api/jobs/${jobId}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const status = String(terminal.status || "");
        const succeeded = status === "succeeded";
        void fetchPodcastWorks();
        return succeeded;
      } catch {
        void fetchPodcastWorks();
        return false;
      }
    },
    [fetchPodcastWorks, getAuthHeaders]
  );

  const onPodcastJobCreated = useCallback(
    (jobId: string) => {
      podcastCancelledRef.current = false;
      podcastActiveJobIdRef.current = jobId;
      rememberJobId(jobId);
      setPodcastGenBusy(true);
      setPodcastGenMessage("任务已创建，正在排队处理…");
      setPodcastPendingStudioWork(buildPodcastPendingStudioWork(jobId, "queued"));
      void (async () => {
        try {
          await waitPodcastJobEvents(jobId);
          if (!podcastCancelledRef.current) {
            const ok = await finalizePodcastJob(jobId);
            if (!podcastCancelledRef.current) {
              if (ok) {
                setPodcastGenMessage(
                  `播客生成完成（${jobId.slice(0, 8)}…）。可在下方「我的作品」或侧栏「创作记录」查看。`
                );
              } else {
                try {
                  const row = (await fetch(`/api/jobs/${jobId}`, {
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { ...getAuthHeaders() }
                  }).then((r) => r.json())) as Record<string, unknown>;
                  const st = String(row.status || "");
                  const err = String(row.error_message || "");
                  setPodcastGenMessage(`处理结果：${st}${err ? ` — ${err}` : ""}`.trim());
                } catch {
                  setPodcastGenMessage("生成未完成或失败，请在「创作记录」查看详情。");
                }
              }
            }
          }
        } finally {
          clearPodcastQueueStallHintTimer();
          clearActiveGenerationJob("podcast");
          podcastActiveJobIdRef.current = null;
          podcastCancelledRef.current = false;
          setPodcastPendingStudioWork(null);
          setPodcastGenBusy(false);
        }
      })();
    },
    [
      waitPodcastJobEvents,
      finalizePodcastJob,
      selectedNotebook,
      buildPodcastPendingStudioWork,
      getAuthHeaders,
      clearPodcastQueueStallHintTimer
    ]
  );

  useEffect(() => {
    if (podcastRecoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("podcast");
    if (!sid) return;
    podcastRecoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("podcast");
          return;
        }
        if (st === "queued" || st === "running") {
          podcastCancelledRef.current = false;
          podcastActiveJobIdRef.current = sid;
          rememberJobId(sid);
          const payload =
            row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
          const nbFromJob = String(payload.notes_notebook || "").trim();
          const jt = String(row.job_type || "podcast_generate").trim();
          setPodcastGenBusy(true);
          setPodcastGenMessage("恢复未完成的生成…");
          setPodcastPendingStudioWork({
            id: sid,
            type: jt || "podcast_generate",
            projectName: NOTES_PODCAST_PROJECT_NAME,
            status: st === "running" ? "running" : "queued",
            notesSourceNotebook: nbFromJob || selectedNotebook.trim() || undefined,
            createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString()
          });
          await waitPodcastJobEvents(sid);
          if (!podcastCancelledRef.current) {
            const ok = await finalizePodcastJob(sid);
            if (!podcastCancelledRef.current) {
              if (ok) {
                setPodcastGenMessage(
                  `播客生成完成（${sid.slice(0, 8)}…）。可在下方「我的作品」或侧栏「创作记录」查看。`
                );
              } else {
                try {
                  const term = (await fetch(`/api/jobs/${sid}`, {
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { ...getAuthHeaders() }
                  }).then((r) => r.json())) as Record<string, unknown>;
                  const st2 = String(term.status || "");
                  const err = String(term.error_message || "");
                  setPodcastGenMessage(`处理结果：${st2}${err ? ` — ${err}` : ""}`.trim());
                } catch {
                  setPodcastGenMessage("生成未完成或失败，请在「创作记录」查看详情。");
                }
              }
            }
          }
          podcastActiveJobIdRef.current = null;
        }
      } catch {
        clearActiveGenerationJob("podcast");
      } finally {
        clearPodcastQueueStallHintTimer();
        clearActiveGenerationJob("podcast");
        podcastCancelledRef.current = false;
        setPodcastPendingStudioWork(null);
        setPodcastGenBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时尝试恢复
  }, [waitPodcastJobEvents, finalizePodcastJob, getAuthHeaders, selectedNotebook, clearPodcastQueueStallHintTimer]);

  const waitDraftJobEvents = useCallback((jobId: string): Promise<void> => {
    return new Promise((resolve) => {
      resolveDraftWaitRef.current = resolve;
      const es = new EventSource(jobEventsSourceUrl(jobId, 0));
      eventSourceRef.current = es;
      activeDraftJobIdRef.current = jobId;
      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as {
            type?: string;
            message?: string;
            payload?: { progress?: number };
          };
          if (data.type === "terminal") {
            es.close();
            eventSourceRef.current = null;
            resolveDraftWaitRef.current = null;
            resolve();
            return;
          }
          if (isJobEventLogOnlyForUi(data.type)) return;
          const msg = String(data.message || "").trim();
          if (msg) setDraftMessage(presentJobProgressMessageForUser(msg));
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        setDraftMessage("连接暂时中断，请到侧栏「创作记录」查看这一条的状态。");
        es.close();
        eventSourceRef.current = null;
        resolveDraftWaitRef.current = null;
        resolve();
      };
    });
  }, []);

  const finalizeDraftJob = useCallback(async (jobId: string): Promise<void> => {
    try {
      const terminal = (await fetch(`/api/jobs/${jobId}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { ...getAuthHeaders() }
      }).then((r) => r.json())) as Record<string, unknown>;
      const status = String(terminal.status || "");
      const err = String(terminal.error_message || "");
      if (status === "succeeded") {
        const payloadRaw = terminal.payload;
        const payload =
          payloadRaw && typeof payloadRaw === "object" && !Array.isArray(payloadRaw)
            ? (payloadRaw as Record<string, unknown>)
            : {};
        const outMode = String(payload.output_mode || payload.outputMode || "").toLowerCase();
        const resultRaw = terminal.result;
        const result =
          resultRaw && typeof resultRaw === "object" && !Array.isArray(resultRaw)
            ? (resultRaw as Record<string, unknown>)
            : {};
        const script = String(
          result.script_text || result.scriptText || result.preview || result.script_preview || ""
        ).trim();
        if (outMode === "article" && script.length >= 40) {
          const title = String(result.title || "文章").trim() || "文章";
          setArticleDraftPreview({ jobId, title, body: script });
          setDraftMessage(
            `生成完成（${jobId.slice(0, 8)}…）。下方可阅读全文并复制；也可在侧栏「创作记录」或右侧「笔记本作品」里查看。`
          );
        } else {
          setArticleDraftPreview(null);
          setDraftMessage(`生成完成（${jobId.slice(0, 8)}…）。可在侧栏「创作记录」或右侧「笔记本作品」里查看。`);
        }
      } else {
        setArticleDraftPreview(null);
        setDraftMessage(`处理结果：${status}${err ? ` — ${err}` : ""}`);
      }
    } catch (e) {
      setArticleDraftPreview(null);
      setDraftMessage(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (draftRecoveryStartedRef.current) return;
    const sid = readActiveGenerationJob("script_draft");
    if (!sid) return;
    draftRecoveryStartedRef.current = true;
    void (async () => {
      try {
        const row = (await fetch(`/api/jobs/${sid}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }).then((r) => r.json())) as Record<string, unknown>;
        const st = String(row.status || "");
        if (st === "succeeded" || st === "failed" || st === "cancelled") {
          clearActiveGenerationJob("script_draft");
          return;
        }
        if (st === "queued" || st === "running") {
          draftCancelledRef.current = false;
          setDraftBusy(true);
          setDraftMessage(`恢复未完成的生成 ${sid}…`);
          rememberJobId(sid);
          activeDraftJobIdRef.current = sid;
          await waitDraftJobEvents(sid);
          if (!draftCancelledRef.current) await finalizeDraftJob(sid);
        }
      } catch {
        clearActiveGenerationJob("script_draft");
      } finally {
        clearActiveGenerationJob("script_draft");
        setDraftBusy(false);
        draftCancelledRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时尝试恢复
  }, [waitDraftJobEvents, finalizeDraftJob, getAuthHeaders]);

  async function createNotebook() {
    const name = newNotebookName.trim();
    if (!name) {
      setNotebookModalError("请输入笔记本名称");
      return;
    }
    setNotebookModalError("");
    setBusy(true);
    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "创建笔记本失败"));
      writeLastNotebookName(name);
      userPrefersNotebookHubRef.current = false;
      setSelectedNotebook(name);
      setHubView(false);
      setNewNotebookName("");
      setShowNotebookModal(false);
      setError("");
      setNotebookMetaByName((prev) => {
        const rest = { ...prev };
        delete rest[name];
        return {
          ...rest,
          [name]: {
            noteCount: 0,
            sourceCount: 0,
            createdAt: new Date().toISOString(),
            instanceId: notesAskClientRequestId()
          }
        };
      });
      setNotebookVisualByName((prev) => {
        if (prev[name]) return prev;
        const next = { ...prev, [name]: randomNotebookVisual() };
        if (typeof window !== "undefined") {
          try {
            writeLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
        }
        return next;
      });
      setNotebooks((prev) => mergeNotebookName(prev, name));
      await loadNotebooks();
      await loadNotebookMeta();
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setNotebookModalError(msg);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function renameNotebookSubmit() {
    const oldN = renameNotebookOld.trim();
    const newN = renameNotebookNew.trim();
    if (!oldN || !newN) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(oldN)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ new_name: newN })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "重命名失败"));
      if (selectedNotebook === oldN) {
        setSelectedNotebook(newN);
        writeLastNotebookName(newN);
      }
      setShowRenameNotebook(false);
      setNotebookMetaByName((prev) => {
        const carry = prev[oldN];
        const next = { ...prev };
        delete next[oldN];
        if (carry) {
          next[newN] = { ...carry, ...(next[newN] || {}) };
        }
        return next;
      });
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function patchNotebookCoverApi(nb: string, body: { coverMode: string; coverPresetId?: string }) {
    const name = nb.trim();
    if (!name) return;
    setNotebookCoverModalBusy(true);
    setNotebookCoverModalErr("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body)
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "保存失败"));
      setShowNotebookCoverModal(false);
      setNotebookCoverModalTarget("");
      await loadNotebooks();
    } catch (err) {
      setNotebookCoverModalErr(String(err instanceof Error ? err.message : err));
    } finally {
      setNotebookCoverModalBusy(false);
    }
  }

  async function uploadNotebookCoverFileApi(nb: string, file: File) {
    const name = nb.trim();
    if (!name) return;
    setNotebookCoverModalBusy(true);
    setNotebookCoverModalErr("");
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}/cover`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": file.type || "application/octet-stream", ...getAuthHeaders() },
        body: buf
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "上传失败"));
      setShowNotebookCoverModal(false);
      setNotebookCoverModalTarget("");
      await loadNotebooks();
    } catch (err) {
      setNotebookCoverModalErr(String(err instanceof Error ? err.message : err));
    } finally {
      setNotebookCoverModalBusy(false);
    }
  }

  async function submitUrlImport() {
    const u = importUrl.trim();
    const nb = selectedNotebook.trim();
    setImportUrlError("");
    if (!u) {
      setImportUrlError("请输入有效的网页链接");
      return;
    }
    if (!nb) {
      setImportUrlError("请先选择或新建笔记本");
      return;
    }
    setImportBusy(true);
    setError("");
    try {
      const res = await fetch("/api/notes/import_url", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          url: u,
          notebook: nb
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        noteId?: string;
        error?: string;
        detail?: unknown;
      };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "导入失败"));
      if (data.noteId) markNoteAsFresh(data.noteId);
      setImportUrl("");
      setImportUrlError("");
      setShowAddNoteModal(false);
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setImportUrlError(String(err instanceof Error ? err.message : err));
    } finally {
      setImportBusy(false);
    }
  }

  async function confirmDeleteNotebook() {
    const target = deleteNotebookTarget || selectedNotebook;
    setDeleteNotebookConfirm(false);
    setDeleteNotebookTarget(null);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(target)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "删除失败"));
      setNotebookMetaByName((prev) => {
        const { [target]: _, ...rest } = prev;
        return rest;
      });
      if (selectedNotebook === target) {
        userPrefersNotebookHubRef.current = true;
        setSelectedNotebook("");
        setHubView(true);
      }
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    const nb = selectedNotebook.trim();
    if (!nb) {
      setError(`${NOTES_NEED_NOTEBOOK}后再上传`);
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const res = await uploadNoteFileWithProgress(file, {
        notebook: nb,
        onProgress: (p) => setUploadProgress(p)
      });
      if (!res.ok) throw new Error(res.error);
      const data = res.data;
      if (data.success === false) throw new Error(apiErrorMessage(data, "上传失败"));
      const newId = data.note?.noteId;
      if (newId) markNoteAsFresh(newId);
      setShowAddNoteModal(false);
      await loadNotebooks();
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  function toggleDraftNote(noteId: string) {
    const hit = notesById.get(noteId);
    if (!hit || !isSourceUsable(hit)) {
      setError("该来源当前不可用，暂不可勾选。");
      return;
    }
    setDraftSelectedNoteIds((prev) => {
      if (prev.includes(noteId)) return prev.filter((x) => x !== noteId);
      if (prev.length >= noteRefCap) {
        setError(notesRefSelectionLimitMessage());
        return prev;
      }
      setError("");
      return [...prev, noteId];
    });
  }

  const onSelectAllOnPageChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const wantSelect = e.target.checked;
      const pageIds = selectableNoteIdsOnPage;
      if (pageIds.length === 0) return;
      if (!wantSelect) {
        /** 取消「选择全部」：清空当前笔记本下已选资料（含其它分页中已勾选的 ID） */
        setDraftSelectedNoteIds([]);
        setError("");
        return;
      }
      /**
       * 本页未全选时表头为 indeterminate；点击后浏览器会先走 checked=true（补全本页），
       * 若已满额再 setError，会卡住且无法切到「取消全选」。已满额且仍有本页缺口时改为整本清空以便恢复操作。
       * 未达上限则静默按条补选至套餐上限，不再弹出限制文案（单条勾选仍可在 toggleDraftNote 中提示）。
       */
      setDraftSelectedNoteIds((prev) => {
        const missingOnPage = pageIds.filter((id) => !prev.includes(id));
        if (missingOnPage.length === 0) return prev;
        if (prev.length >= noteRefCap) {
          return [];
        }
        const next = [...prev];
        for (const id of pageIds) {
          if (next.length >= noteRefCap) break;
          if (!next.includes(id)) next.push(id);
        }
        return next;
      });
      setError("");
    },
    [selectableNoteIdsOnPage, noteRefCap]
  );

  async function submitNotesAsk() {
    const nb = selectedNotebook.trim();
    if (!nb) {
      setNotesAskError(NOTES_NEED_NOTEBOOK);
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setNotesAskError(NOTES_ASK_SOURCE_REQUIRED);
      return;
    }
    const q = notesAskQuestion.trim();
    if (!q) {
      setNotesAskError("请输入要问资料的问题");
      return;
    }
    const userMsgId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const chatHistory = notesAskMessages
      .filter((m) => !m.streaming && !m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX))
      .slice(-8)
      .map((m) => ({ role: m.role, content: (m.content || "").trim() }))
      .filter((m) => m.content);
    setNotesAskError("");
    if (notesAskStreamInfoTimerRef.current) {
      clearTimeout(notesAskStreamInfoTimerRef.current);
      notesAskStreamInfoTimerRef.current = null;
    }
    setNotesAskStreamInfo("");
    setNotesAskBusy(true);
    setNotesAskMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: q },
      { id: assistantId, role: "assistant", content: "", streaming: true }
    ]);
    setNotesAskQuestion("");
    const streamRid = notesAskClientRequestId();
    notesAskClientLog("info", "stream", "request_start", {
      requestId: streamRid,
      notebook: nb,
      noteCount: draftSelectedNoteIds.length,
      questionLen: q.length,
      url: notesAskBffUrl("/api/notes/ask/stream")
    });
    const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const streamT0 = nowMs();
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    let chunkChars = 0;
    let streamFetchMs = 0;
    let requestOutcome: "completed" | "failed" | "incomplete" | "aborted" = "failed";
    const streamAbort = new AbortController();
    notesAskStreamAbortRef.current = streamAbort;
    try {
      const res = await fetch(notesAskBffUrl("/api/notes/ask/stream"), {
        method: "POST",
        credentials: notesAskFetchCredentials(),
        signal: streamAbort.signal,
        headers: {
          "content-type": "application/json",
          "x-request-id": streamRid,
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          notebook: nb,
          note_ids: draftSelectedNoteIds,
          question: q,
          chatHistory,
          ...(sharedBrowse?.ownerUserId ? { sharedFromOwnerUserId: sharedBrowse.ownerUserId } : {})
        })
      });
      streamFetchMs = Math.round(nowMs() - streamT0);
      notesAskClientLog("info", "stream", "fetch_resolved", {
        requestId: streamRid,
        httpStatus: res.status,
        ms: streamFetchMs
      });
      if (!res.ok) {
        const rawText = await res.text();
        let data = {} as {
          success?: boolean;
          detail?: unknown;
          error?: string;
          requestId?: string;
        };
        if (rawText.trim()) {
          try {
            data = JSON.parse(rawText) as typeof data;
          } catch {
            data = {};
          }
        }
        const fallback =
          rawText.trim().slice(0, 400) ||
          `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
        const ridOut =
          res.headers.get("x-request-id")?.trim() ||
          (typeof data.requestId === "string" ? data.requestId.trim() : "") ||
          streamRid;
        const streamMeta: NotesAskStreamErrorMeta = {
          httpStatus: res.status,
          requestId: ridOut,
          rawPreview:
            !rawText.trim().startsWith("{") && rawText.trim().length > 0
              ? rawText.trim().slice(0, 900)
              : undefined
        };
        notesAskClientLog("warn", "stream", "http_error", {
          requestId: ridOut,
          httpStatus: res.status,
          bodyPreview: rawText.trim().slice(0, 800)
        });
        throw new Error(formatNotesAskStreamError(apiErrorMessage(data, fallback), streamMeta));
      }
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/event-stream") || !res.body) {
        const t = await res.text();
        notesAskClientLog("warn", "stream", "unexpected_content_type", {
          requestId: res.headers.get("x-request-id")?.trim() || streamRid,
          httpStatus: res.status,
          contentType: ct || "(missing)",
          bodyPreview: t.trim().slice(0, 800)
        });
        throw new Error(
          formatNotesAskStreamError(t || "未返回流式响应", {
            httpStatus: res.status,
            requestId: res.headers.get("x-request-id")?.trim() || streamRid,
            rawPreview: t.trim().slice(0, 900) || undefined
          })
        );
      }
      notesAskClientLog("info", "stream", "sse_opened", {
        requestId: res.headers.get("x-request-id")?.trim() || streamRid,
        contentType: ct,
        ttfbMs: streamFetchMs
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      /**
       * 合并 SSE 片段后再 setState，避免每 token 一次重渲染。
       * - 勿用 rAF 驱动流式：后台标签页 rAF 会被强烈节流。
       * - 前台：短 interval + 较大字符阈值，平衡流畅度与渲染次数。
       * - 后台：timer 常被夹到 ~1s，故降低字符阈值并加长 fallback timer，仍依赖 visibility 立即 flush。
       */
      let chunkPendingAnswer = "";
      let chunkPendingReasoning = "";
      let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const STREAM_FLUSH_MS_VISIBLE = 32;
      const STREAM_FLUSH_CHARS_VISIBLE = 200;
      const STREAM_FLUSH_CHARS_HIDDEN = 72;
      /** 后台短 timer 不可靠，仅作「少量尾字」兜底 */
      const STREAM_FLUSH_MS_HIDDEN_FALLBACK = 480;

      const streamTabHidden = () =>
        typeof document !== "undefined" && document.visibilityState === "hidden";

      const streamFlushCharThreshold = () =>
        streamTabHidden() ? STREAM_FLUSH_CHARS_HIDDEN : STREAM_FLUSH_CHARS_VISIBLE;

      const applyPendingChunks = () => {
        const batchA = chunkPendingAnswer;
        const batchR = chunkPendingReasoning;
        chunkPendingAnswer = "";
        chunkPendingReasoning = "";
        if (!batchA && !batchR) return;
        setNotesAskMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const cur = next[idx]!;
          next[idx] = {
            ...cur,
            ...(batchA ? { content: (cur.content || "") + batchA } : {}),
            ...(batchR ? { streamingReasoning: (cur.streamingReasoning || "") + batchR } : {}),
            streaming: true
          };
          return next;
        });
      };
      const clearChunkFlushTimer = () => {
        if (chunkFlushTimer != null) {
          clearTimeout(chunkFlushTimer);
          chunkFlushTimer = null;
        }
      };
      const scheduleChunkFlush = () => {
        if (chunkFlushTimer != null) return;
        const delay = streamTabHidden()
          ? STREAM_FLUSH_MS_HIDDEN_FALLBACK
          : STREAM_FLUSH_MS_VISIBLE;
        chunkFlushTimer = setTimeout(() => {
          chunkFlushTimer = null;
          applyPendingChunks();
        }, delay);
      };
      const flushChunksNow = () => {
        clearChunkFlushTimer();
        applyPendingChunks();
      };
      /** 可见/隐藏切换时都 flush：回前台立刻看到缓冲；切后台提交已收未画出的字 */
      const onVisibilityFlush = () => {
        flushChunksNow();
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityFlush);
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? "";
          for (const block of parts) {
            for (const line of block.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const raw = trimmed.slice(5).trim();
              if (!raw) continue;
              let ev: NotesAskStreamEvent;
              try {
                ev = JSON.parse(raw) as NotesAskStreamEvent;
              } catch {
                notesAskClientLog("warn", "stream", "sse_data_json_parse_failed", {
                  requestId: streamRid,
                  rawPreview: raw.slice(0, 400)
                });
                continue;
              }
              if (ev.type === "info") {
                const msg = String((ev as { message?: string }).message ?? "").trim();
                if (msg) {
                  setNotesAskStreamInfo(msg);
                  if (notesAskStreamInfoTimerRef.current) clearTimeout(notesAskStreamInfoTimerRef.current);
                  notesAskStreamInfoTimerRef.current = setTimeout(() => {
                    setNotesAskStreamInfo("");
                    notesAskStreamInfoTimerRef.current = null;
                  }, 14000);
                }
              } else if (ev.type === "chunk") {
                const chunkText = String(ev.text ?? "");
                if (!chunkText) continue;
                const rawRole = (ev as { streamRole?: string }).streamRole;
                const streamRole =
                  rawRole === "reasoning" || rawRole === "answer" ? rawRole : "answer";
                if (firstChunkAt == null) {
                  firstChunkAt = nowMs();
                  notesAskClientLog("info", "stream", "first_chunk", {
                    requestId: streamRid,
                    ttfChunkMs: Math.round(firstChunkAt - streamT0),
                    ttfbMs: streamFetchMs
                  });
                }
                chunkCount += 1;
                chunkChars += chunkText.length;
                if (streamRole === "reasoning") {
                  chunkPendingReasoning += chunkText;
                } else {
                  chunkPendingAnswer += chunkText;
                }
                const pendingTotal = chunkPendingAnswer.length + chunkPendingReasoning.length;
                if (pendingTotal >= streamFlushCharThreshold()) {
                  clearChunkFlushTimer();
                  applyPendingChunks();
                } else {
                  scheduleChunkFlush();
                }
              } else if (ev.type === "done") {
                flushChunksNow();
                sawDone = true;
                const doneSources = normalizeNotesAskSources(ev.sources);
                notesAskClientLog("info", "stream", "done_event", {
                  requestId: streamRid,
                  chunkCount,
                  chunkChars,
                  doneMs: Math.round(nowMs() - streamT0)
                });
                setNotesAskMessages((prev) => {
                  const next = [...prev];
                  const idx = next.findIndex((m) => m.id === assistantId);
                  if (idx < 0) return prev;
                  next[idx] = {
                    ...next[idx]!,
                    streaming: false,
                    streamingReasoning: undefined,
                    ...(doneSources?.length ? { sources: doneSources } : {})
                  };
                  return next;
                });
              } else if (ev.type === "error") {
                flushChunksNow();
                notesAskClientLog("error", "stream", "sse_error_event", {
                  requestId: streamRid,
                  code: ev.code,
                  message: String(ev.message || "").trim().slice(0, 500),
                  detail: ev.detail,
                  textProvider: ev.textProvider,
                  hint: ev.hint
                });
                throw new Error(
                  formatNotesAskStreamError(String(ev.message || "").trim() || "问答失败", {
                    code: ev.code,
                    detail: ev.detail,
                    requestId: ev.requestId,
                    textProvider: ev.textProvider,
                    hint: ev.hint
                  })
                );
              }
            }
          }
        }
      } finally {
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibilityFlush);
        }
        flushChunksNow();
      }
      if (!sawDone) {
        notesAskClientLog("warn", "stream", "incomplete_no_done_event", {
          requestId: streamRid,
          bufferTail: buffer.trim().slice(-500),
          chunkCount,
          chunkChars,
          totalMs: Math.round(nowMs() - streamT0)
        });
        requestOutcome = "incomplete";
        const incomplete =
          "流式回答未正常结束（连接中断或未收到完成事件），请检查网络后重试；若部署在云端，请确认网关与编排器超时时间足够长。";
        setNotesAskError(incomplete);
        setNotesAskMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId || !m.streaming) return m;
            const body = (m.content || "").trim();
            return {
              ...m,
              streaming: false,
              streamingReasoning: undefined,
              // 完整说明已在上方红字区，避免气泡内再嵌一整段重复
              content: body || "（本次未生成正文，详见上方红色错误说明。）"
            };
          })
        );
      } else {
        requestOutcome = "completed";
        notesAskClientLog("info", "stream", "sse_completed", {
          requestId: streamRid,
          totalMs: Math.round(nowMs() - streamT0),
          ttfbMs: streamFetchMs,
          ttfChunkMs: firstChunkAt == null ? null : Math.round(firstChunkAt - streamT0),
          streamMs: firstChunkAt == null ? null : Math.round(nowMs() - firstChunkAt),
          chunkCount,
          chunkChars
        });
      }
    } catch (err) {
      if (isNotesAskAbortError(err)) {
        requestOutcome = "aborted";
        notesAskClientLog("info", "stream", "user_aborted", { requestId: streamRid });
        setNotesAskError("");
        setNotesAskStreamInfo("");
        if (notesAskStreamInfoTimerRef.current) {
          clearTimeout(notesAskStreamInfoTimerRef.current);
          notesAskStreamInfoTimerRef.current = null;
        }
        setNotesAskMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.streaming
              ? { ...m, streaming: false, streamingReasoning: undefined }
              : m
          )
        );
      } else {
        requestOutcome = "failed";
        const msg = formatNotesAskStreamError(String(err instanceof Error ? err.message : err));
        notesAskClientLog("error", "stream", "request_failed", {
          requestId: streamRid,
          message: msg.slice(0, 1200)
        });
        setNotesAskError(msg);
        setNotesAskMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx < 0) return prev;
          const cur = next[idx]!;
          next[idx] = {
            ...cur,
            streaming: false,
            streamingReasoning: undefined,
            content: (cur.content || "").trim() || "（本次未生成正文，详见上方红色错误说明。）"
          };
          return next;
        });
      }
    } finally {
      if (notesAskStreamAbortRef.current === streamAbort) {
        notesAskStreamAbortRef.current = null;
      }
      const totalMs = Math.round(nowMs() - streamT0);
      notesAskClientLog("debug", "stream", "request_finished", {
        requestId: streamRid,
        outcome: requestOutcome,
        totalMs,
        ttfbMs: streamFetchMs,
        ttfChunkMs: firstChunkAt == null ? null : Math.round(firstChunkAt - streamT0),
        chunkCount,
        chunkChars
      });
      setNotesAskBusy(false);
    }
  }

  async function copyNotesAskAnswer(text: string) {
    const t = (text || "").trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setNotesAskError("");
    } catch (err) {
      setNotesAskError(String(err instanceof Error ? err.message : err));
    }
  }

  async function copyArticleDraftBody() {
    const t = (articleDraftPreview?.body || "").trim();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setError("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  async function shareNotesAskAnswer(text: string) {
    const t = (text || "").trim();
    if (!t) return;
    try {
      if (typeof navigator !== "undefined" && "share" in navigator && typeof navigator.share === "function") {
        await navigator.share({ title: "知识库回答", text: t });
      } else {
        await navigator.clipboard.writeText(t);
      }
      setNotesAskError("");
    } catch (err) {
      const e = err as Error;
      if (e?.name === "AbortError") return;
      setNotesAskError(String(e?.message || err));
    }
  }

  async function saveAskAnswerAsNote(text: string, msgId: string) {
    if (sharedBrowse) {
      setNotesAskError("分享浏览模式下不可保存为新笔记。");
      return;
    }
    const nb = selectedNotebook.trim();
    if (!nb) {
      setNotesAskError(NOTES_NEED_NOTEBOOK);
      return;
    }
    const raw = (text || "").trim();
    if (!raw) return;
    const firstLine = raw.split(/\n/).find((l) => l.trim())?.trim() || "";
    const title = (firstLine.replace(/[#*`>]+/g, "").slice(0, 80) || "问答摘录").trim();
    setNotesAskNoteBusyId(msgId);
    setNotesAskError("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          project_name: NOTES_PODCAST_PROJECT_NAME,
          title: title || "问答摘录",
          notebook: nb,
          content: raw
        })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: unknown };
      if (!res.ok) throw new Error(apiErrorMessage(data, "保存失败"));
      await loadNotebookMeta();
      await loadNotes();
    } catch (err) {
      setNotesAskError(String(err instanceof Error ? err.message : err));
    } finally {
      setNotesAskNoteBusyId(null);
    }
  }

  async function submitArticleDraft() {
    if (sharedBrowse?.access === "read_only") {
      setError("当前为只读分享笔记本，不可生成文章。");
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setError("请至少勾选一条笔记");
      return;
    }
    const body = artText.trim();
    if (!body) {
      setError("请填写 AI 提词");
      return;
    }
    const preset = ART_KIND_PRESETS[artKind];
    const programName = (preset.programName && preset.programName.trim()) || "笔记文章";
    draftCancelledRef.current = false;
    setDraftBusy(true);
    setDraftMessage("");
    setArticleDraftPreview(null);
    setError("");
    try {
      const data = await createJob({
        project_name: NOTES_PODCAST_PROJECT_NAME,
        job_type: "script_draft",
        queue_name: "ai",
        created_by: createdByPhone || undefined,
        payload: {
          text: body,
          script_target_chars: Math.min(NOTES_ART_TARGET_CHARS_MAX, Math.max(NOTES_ART_TARGET_CHARS_MIN, artChars)),
          notes_notebook: selectedNotebook.trim(),
          ...(sharedBrowse?.access === "edit" && sharedBrowse.ownerUserId
            ? { notes_source_owner_user_id: sharedBrowse.ownerUserId }
            : {}),
          ...buildReferenceJobFields({
            urlListText: "",
            selectedNoteIds: draftSelectedNoteIds,
            selectedNoteTitles: draftSelectedNoteIds.map((id) => (noteTitleById[id] || "").trim()),
            referenceExtra: "",
            useRag: true,
            ragMaxChars: 56_000,
            referenceRagMode: "truncate" as ReferenceRagMode
          }),
          script_style: "简洁清晰，重点突出",
          script_language: artLang,
          program_name: programName,
          speaker1_persona: "主持人",
          speaker2_persona: "分析师",
          script_constraints: "",
          output_mode: "article",
          generate_cover: true,
          ...(artCoreQuestion.trim() ? { core_question: artCoreQuestion.trim() } : {})
        }
      });
      rememberJobId(data.id);
      setActiveGenerationJob("script_draft", data.id);
      setDraftMessage(`记录 ${data.id.slice(0, 8)}…：已创建，正在监听进度`);
      setShowArticleModal(false);
      setArticleModalStep("pick");
      activeDraftJobIdRef.current = data.id;
      await waitDraftJobEvents(data.id);
      if (!draftCancelledRef.current) await finalizeDraftJob(data.id);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      clearActiveGenerationJob("script_draft");
      setDraftBusy(false);
      activeDraftJobIdRef.current = null;
    }
  }

  async function confirmDeleteNote(noteId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { ...getAuthHeaders() }
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "删除失败"));
      await loadNotes();
      await loadNotebooks();
      await loadNotebookMeta();
      setDraftSelectedNoteIds((prev) => prev.filter((x) => x !== noteId));
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(noteId: string, opts: { highlightText?: string } = {}) {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewTitle("");
    setPreviewText("");
    setPreviewTruncated(false);
    setPreviewStatusLine("");
    setPreviewKw("");
    setPreviewSourceType("");
    setPreviewSourceUrl("");
    setPreviewCreatedAt("");
    setPreviewWordCount(0);
    setPreviewStage("");
    setPreviewNextAction("");
    setPreviewSimplified(false);
    setPreviewHighlightHint("");
    try {
      const pv = new URLSearchParams();
      if (sharedBrowse?.ownerUserId) pv.set("sharedFromOwnerUserId", sharedBrowse.ownerUserId);
      const qs = pv.toString();
      const res = await fetch(
        `/api/notes/${encodeURIComponent(noteId)}/preview_text${qs ? `?${qs}` : ""}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        }
      );
      const data = (await res.json().catch(() => ({}))) as PreviewResp & { detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "预览失败"));
      setPreviewTitle(data.title || "");
      setPreviewText(data.text || "");
      setPreviewTruncated(!!data.truncated);
      setPreviewSourceType(String(data.sourceType || ""));
      setPreviewSourceUrl(String(data.sourceUrl || ""));
      setPreviewCreatedAt(String(data.createdAt || ""));
      setPreviewWordCount(Number(data.wordCount || 0));
      setPreviewStage(String(data.preprocessStage || ""));
      setPreviewNextAction(String(data.nextAction || ""));
      const statusParts: string[] = [];
      if (data.parseStatus && data.parseStatus !== "ok") {
        statusParts.push(
          `正文解析：${data.parseStatus}${data.parseDetail ? ` — ${data.parseDetail.slice(0, 220)}` : ""}`
        );
      }
      if (data.parseErrorCode) {
        statusParts.push(`解析错误码：${data.parseErrorCode}`);
      }
      if (data.ragIndexError) {
        statusParts.push(`向量索引失败：${data.ragIndexError}`);
      } else if (typeof data.ragChunkCount === "number" && data.ragChunkCount > 0) {
        statusParts.push(
          `向量块 ${data.ragChunkCount} 条${data.ragIndexedAt ? ` · ${data.ragIndexedAt}` : ""}`
        );
      }
      setPreviewStatusLine(statusParts.join(" · "));
      const hi = String(opts.highlightText || "").trim();
      if (hi) {
        const kw = hi.slice(0, 24);
        if (kw) setPreviewKw(kw);
        setPreviewHighlightHint(hi.slice(0, 80));
      }
    } catch (err) {
      setPreviewText(String(err instanceof Error ? err.message : err));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveRenameNote() {
    if (!renameNoteId) return;
    const t = renameNoteTitle.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(renameNoteId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: t })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "重命名失败"));
      setRenameNoteId(null);
      await loadNotes();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const filteredPreview = useMemo(() => {
    const base = previewSimplified ? simplifySourceText(previewText) : previewText;
    const kw = previewKw.trim();
    if (!kw) return base;
    const lines = base.split("\n");
    return lines.filter((l) => l.includes(kw)).join("\n");
  }, [previewText, previewKw, previewSimplified]);

  function openNotebook(name: string) {
    setNotebookCardMenu(null);
    userPrefersNotebookHubRef.current = false;
    writeLastNotebookName(name);
    setSelectedNotebook(name);
    setSharedBrowse(null);
    setHubView(false);
    setError("");
  }

  function openSharedNotebookFromPopular(item: PopularNotebookItem) {
    setNotebookCardMenu(null);
    userPrefersNotebookHubRef.current = false;
    const access: SharedBrowseContext["access"] = item.publicAccess === "edit" ? "edit" : "read_only";
    setSelectedNotebook(item.notebook);
    setSharedBrowse({ ownerUserId: item.ownerUserId, access });
    setHubView(false);
    setError("");
    const key = `${item.ownerUserId}:${item.notebook}`;
    if (shareViewedKeyRef.current !== key) {
      shareViewedKeyRef.current = key;
      void fetch("/api/notebooks/view", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ ownerUserId: item.ownerUserId, notebook: item.notebook })
      }).catch(() => {});
    }
  }

  async function submitNotebookSharing() {
    const name = shareTargetNotebook.trim();
    if (!name) return;
    setShareModalBusy(true);
    setShareModalError("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}/share`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          isPublic: true,
          publicAccess: shareFormAccess,
          /** 与「热门笔记本」一致：分享即允许参与发现筛选（仍受后端内容门槛过滤）；取消分享会清零 */
          listedInDiscover: true
        })
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(apiErrorMessage(data, "保存失败"));
      await loadNotebooks();
      void loadPopularNotebooks(false);
      setShowShareNotebookModal(false);
    } catch (err) {
      setShareModalError(String(err instanceof Error ? err.message : err));
    } finally {
      setShareModalBusy(false);
    }
  }

  async function submitStopNotebookSharing() {
    const name = shareTargetNotebook.trim();
    if (!name) return;
    setShareModalBusy(true);
    setShareModalError("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}/share`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          isPublic: false,
          publicAccess: null,
          listedInDiscover: false
        })
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) throw new Error(apiErrorMessage(data, "保存失败"));
      await loadNotebooks();
      void loadPopularNotebooks(false);
      setShowShareNotebookModal(false);
    } catch (err) {
      setShareModalError(String(err instanceof Error ? err.message : err));
    } finally {
      setShareModalBusy(false);
    }
  }

  function openPodcastFlow() {
    if (sharedBrowse?.access === "read_only") {
      setError("当前为只读分享笔记本，不可生成播客。");
      return;
    }
    if (!selectedNotebook.trim()) {
      setError(`生成播客：${NOTES_NEED_NOTEBOOK}`);
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setError(`生成播客：${NOTES_ASK_SOURCE_REQUIRED}`);
      return;
    }
    setError("");
    setShowPodcastGenreModal(true);
  }

  function openArticleFlow() {
    if (sharedBrowse?.access === "read_only") {
      setError("当前为只读分享笔记本，不可生成文章。");
      return;
    }
    if (!selectedNotebook.trim()) {
      setError(`生成文章：${NOTES_NEED_NOTEBOOK}`);
      return;
    }
    if (draftSelectedNoteIds.length === 0) {
      setError(`生成文章：${NOTES_ASK_SOURCE_REQUIRED}`);
      return;
    }
    setError("");
    setArticleModalStep("pick");
    setArtKind("custom");
    setArtLang("中文");
    setArtChars(NOTES_ART_TARGET_CHARS_DEFAULT);
    setArtCharsInput(String(NOTES_ART_TARGET_CHARS_DEFAULT));
    setShowArticleModal(true);
  }

  function pickArticleKind(k: ArtKindKey) {
    setArtKind(k);
    const extra = notesStudioPrompt.trim();
    if (k === "custom") {
      setArtText(extra || "");
    } else {
      const prefix = ART_KIND_PRESETS[k].textPrefix;
      setArtText(extra ? `${prefix}\n\n${extra}` : prefix);
    }
    setArticleModalStep("form");
  }

  function commitArtCharsInput() {
    const parsed = Number(artCharsInput);
    if (Number.isNaN(parsed)) {
      setArtCharsInput(String(artChars));
      return;
    }
    const clamped = Math.min(
      NOTES_ART_TARGET_CHARS_MAX,
      Math.max(NOTES_ART_TARGET_CHARS_MIN, Math.round(parsed))
    );
    setArtChars(clamped);
    setArtCharsInput(String(clamped));
  }

  return (
    <main
      data-notes-workbench={hubView ? undefined : ""}
      className={
        hubView
          ? "mx-auto min-h-0 w-full max-w-[min(100%,1800px)] px-3 pb-10 sm:px-4"
          : "min-h-0 w-full max-w-none pb-10"
      }
      onPointerDown={onNotesMainPointerDown}
    >
      {error ? <p className="mb-4 text-sm text-danger-ink">{error}</p> : null}

      {/* 在笔记本列表页无法看到右侧「我的作品」时，仍显示文章/底稿/播客生成日志（如页面恢复未完成 job） */}
      {hubView && (draftMessage.trim() || podcastGenBusy || podcastGenMessage.trim()) ? (
        <div className="mb-4 space-y-2">
          {podcastGenBusy || podcastGenMessage.trim() ? (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                podcastGenBusy
                  ? "border-brand/25 bg-fill/90 text-brand"
                  : podcastGenMessage.includes("完成")
                    ? "border-success/35 bg-success-soft/80 text-success-ink"
                    : "border-warning/35 bg-warning-soft/70 text-warning-ink"
              }`}
              role="status"
              aria-live="polite"
            >
              <p className="leading-snug">{podcastGenMessage || "…"}</p>
              {messageSuggestsBillingTopUpOrSubscription(podcastGenMessage) ? (
                <BillingShortfallLinks className="mt-2 text-[11px] normal-case" />
              ) : null}
            </div>
          ) : null}
          {draftMessage ? (
            <div
              className={`rounded-xl border px-3 py-2 text-xs ${
                draftBusy
                  ? "border-brand/25 bg-fill/90 text-brand"
                  : "border-success/35 bg-success-soft/80 text-success-ink"
              }`}
              role="status"
              aria-live="polite"
            >
              <p className="leading-snug">{draftMessage}</p>
              {messageSuggestsBillingTopUpOrSubscription(draftMessage) ? (
                <BillingShortfallLinks className="mt-2 text-[11px] normal-case" />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {hubView ? (
        <>
          <div
            className="mb-4 flex gap-1 rounded-xl border border-line/60 bg-fill/35 p-1"
            role="tablist"
            aria-label="笔记本发现"
          >
            <button
              type="button"
              role="tab"
              aria-selected={hubDiscoverTab === "all"}
              className={`min-w-0 flex-1 rounded-lg border px-2 py-2.5 text-xs transition-colors sm:px-3 sm:text-sm ${
                hubDiscoverTab === "all"
                  ? "border-brand/40 bg-surface font-semibold text-ink shadow-md ring-2 ring-brand/20"
                  : "border-transparent font-medium text-muted hover:border-line/60 hover:bg-fill/50 hover:text-ink"
              }`}
              onClick={() => setHubDiscoverTab("all")}
            >
              全部笔记本
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={hubDiscoverTab === "mine"}
              className={`min-w-0 flex-1 rounded-lg border px-2 py-2.5 text-xs transition-colors sm:px-3 sm:text-sm ${
                hubDiscoverTab === "mine"
                  ? "border-brand/40 bg-surface font-semibold text-ink shadow-md ring-2 ring-brand/20"
                  : "border-transparent font-medium text-muted hover:border-line/60 hover:bg-fill/50 hover:text-ink"
              }`}
              onClick={() => setHubDiscoverTab("mine")}
            >
              我的笔记本
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={hubDiscoverTab === "popular"}
              className={`min-w-0 flex-1 rounded-lg border px-2 py-2.5 text-xs transition-colors sm:px-3 sm:text-sm ${
                hubDiscoverTab === "popular"
                  ? "border-brand/40 bg-surface font-semibold text-ink shadow-md ring-2 ring-brand/20"
                  : "border-transparent font-medium text-muted hover:border-line/60 hover:bg-fill/50 hover:text-ink"
              }`}
              onClick={() => setHubDiscoverTab("popular")}
            >
              热门笔记本
            </button>
          </div>
          <section className={card}>
            {hubDiscoverTab === "all" ? (
              <>
                <h3 className="text-sm font-semibold text-ink">我的笔记本</h3>
                <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                  {notebooks.length === 0 ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-soft transition-opacity hover:opacity-95"
                      onClick={() => {
                        setNotebookModalError("");
                        setNewNotebookName("");
                        setShowNotebookModal(true);
                      }}
                    >
                      新建笔记本
                    </button>
                  ) : null}
                </div>
                {notebooks.length === 0 ? (
                  <EmptyState
                    title="还没有笔记本"
                    description="新建后添加资料，即可在右侧提问或生成。"
                    className="mt-4 border-dashed border-line bg-fill/40 py-8"
                  />
                ) : (
                  <div className="mt-3">
                    <div
                      ref={hubAllMineClipRef}
                      className={hubAllMineExpanded ? "min-w-0" : "max-h-[196px] min-w-0 overflow-hidden"}
                    >
                      <div ref={hubAllMineMeasureRef}>
                        <HubMineNotebookCards
                          notebooks={notebooks}
                          notebookVisualByName={notebookVisualByName}
                          notebookMetaByName={notebookMetaByName}
                          notebookSharingByName={notebookSharingByName}
                          notebookCoverByName={notebookCoversByName}
                          notebookCardMenu={notebookCardMenu}
                          setNotebookCardMenu={setNotebookCardMenu}
                          onOpenNotebook={openNotebook}
                          onRequestNewNotebook={() => {
                            setNotebookModalError("");
                            setShowNotebookModal(true);
                            setNewNotebookName("");
                          }}
                          showNewTile
                          listClassName="flex flex-wrap gap-3"
                          onShareNotebook={(nb) => {
                            const row = notebookSharingByName[nb];
                            setShareTargetNotebook(nb);
                            setShareFormAccess(row?.publicAccess === "edit" ? "edit" : "read_only");
                            setShareModalError("");
                            setShowShareNotebookModal(true);
                          }}
                          onRenameNotebook={(nb) => {
                            setRenameNotebookOld(nb);
                            setRenameNotebookNew("");
                            setShowRenameNotebook(true);
                          }}
                          onDeleteNotebook={(nb) => {
                            setDeleteNotebookTarget(nb);
                            setDeleteNotebookConfirm(true);
                          }}
                          onNotebookCoverSettings={(nb) => {
                            setNotebookCoverModalTarget(nb);
                            setNotebookCoverModalErr("");
                            setShowNotebookCoverModal(true);
                          }}
                        />
                      </div>
                    </div>
                    {!hubAllMineExpanded && hubAllMineHasOverflow ? (
                      <button
                        type="button"
                        className="mt-2 text-sm font-medium text-brand underline decoration-brand/35 underline-offset-2 hover:opacity-90"
                        onClick={() => setHubAllMineExpanded(true)}
                      >
                        查看更多
                      </button>
                    ) : null}
                    {hubAllMineExpanded && hubAllMineHasOverflow ? (
                      <button
                        type="button"
                        className="mt-2 text-sm font-medium text-muted underline decoration-line underline-offset-2 hover:text-ink"
                        onClick={() => setHubAllMineExpanded(false)}
                      >
                        收起
                      </button>
                    ) : null}
                  </div>
                )}
                <h3 className="mt-8 text-sm font-semibold text-ink">热门笔记本</h3>
                <div className="mt-2 min-h-0 max-h-[min(70dvh,560px)] min-w-0 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
                  <HubPopularNotebookGrid
                    popularLoading={popularLoading}
                    popularItems={popularItems}
                    onPick={openSharedNotebookFromPopular}
                    showLoadMore
                    popularHasMore={popularHasMore}
                    popularLoadingMore={popularLoadingMore}
                    onPopularLoadMore={() => void loadPopularNotebooks(true)}
                  />
                </div>
              </>
            ) : hubDiscoverTab === "mine" ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-ink">笔记本</h2>
                  </div>
                  {notebooks.length === 0 ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-soft transition-opacity hover:opacity-95"
                      onClick={() => {
                        setNotebookModalError("");
                        setNewNotebookName("");
                        setShowNotebookModal(true);
                      }}
                    >
                      新建笔记本
                    </button>
                  ) : null}
                </div>
                {notebooks.length === 0 ? (
                  <EmptyState
                    title="还没有笔记本"
                    description="新建后添加资料，即可在右侧提问或生成。"
                    className="mt-4 border-dashed border-line bg-fill/40 py-8"
                  />
                ) : null}
                <div className="mt-4">
                  <HubMineNotebookCards
                    notebooks={notebooks}
                    notebookVisualByName={notebookVisualByName}
                    notebookMetaByName={notebookMetaByName}
                    notebookSharingByName={notebookSharingByName}
                    notebookCoverByName={notebookCoversByName}
                    notebookCardMenu={notebookCardMenu}
                    setNotebookCardMenu={setNotebookCardMenu}
                    onOpenNotebook={openNotebook}
                    onRequestNewNotebook={() => {
                      setNotebookModalError("");
                      setShowNotebookModal(true);
                      setNewNotebookName("");
                    }}
                    showNewTile={notebooks.length > 0}
                    listClassName="flex gap-3 overflow-x-auto pb-2"
                    onShareNotebook={(nb) => {
                      const row = notebookSharingByName[nb];
                      setShareTargetNotebook(nb);
                      setShareFormAccess(row?.publicAccess === "edit" ? "edit" : "read_only");
                      setShareModalError("");
                      setShowShareNotebookModal(true);
                    }}
                    onRenameNotebook={(nb) => {
                      setRenameNotebookOld(nb);
                      setRenameNotebookNew("");
                      setShowRenameNotebook(true);
                    }}
                    onDeleteNotebook={(nb) => {
                      setDeleteNotebookTarget(nb);
                      setDeleteNotebookConfirm(true);
                    }}
                    onNotebookCoverSettings={(nb) => {
                      setNotebookCoverModalTarget(nb);
                      setNotebookCoverModalErr("");
                      setShowNotebookCoverModal(true);
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="mt-1 min-h-0 max-h-[min(85dvh,720px)] min-w-0 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
                <HubPopularNotebookGrid
                  popularLoading={popularLoading}
                  popularItems={popularItems}
                  onPick={openSharedNotebookFromPopular}
                  showLoadMore
                  popularHasMore={popularHasMore}
                  popularLoadingMore={popularLoadingMore}
                  onPopularLoadMore={() => void loadPopularNotebooks(true)}
                />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div
            className={[
              "mb-4 flex min-w-0 items-center gap-2",
              sourcesPanelCollapsed
                ? "w-full"
                : "w-full lg:w-64 lg:min-w-[15rem] lg:max-w-[17rem] xl:w-72 xl:max-w-[18rem]"
            ].join(" ")}
          >
            <button
              type="button"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-lg text-ink hover:bg-fill"
              aria-label="返回笔记本列表"
              title="返回笔记本列表"
              onClick={() => {
                userPrefersNotebookHubRef.current = true;
                setSharedBrowse(null);
                dismissNotesBlockingOverlays();
                setHubView(true);
              }}
            >
              ←
            </button>
            {sharedBrowse ? (
              <div className="min-w-0 flex-1 rounded-lg border border-line bg-fill/35 px-3 py-2">
                <p className="truncate text-sm font-semibold text-ink" title={selectedNotebook}>
                  {selectedNotebook}
                </p>
                <p className="mt-0.5 text-[10px] text-muted">
                  {sharedBrowse.access === "edit" ? "他人分享 · 可提问与基于来源生成" : "他人分享 · 仅可提问"}
                </p>
              </div>
            ) : notebooks.length >= 1 ? (
              <div className="min-w-0 flex-1">
                <select
                  className={`block w-full ${inputCls}`}
                  value={selectedNotebook}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new_notebook__") {
                      setNotebookModalError("");
                      setNewNotebookName("");
                      setShowNotebookModal(true);
                      return;
                    }
                    openNotebook(v);
                  }}
                  aria-label="筛选并切换笔记本，可选新建笔记本"
                >
                  {notebooks.map((nb) => (
                    <option key={nb} value={nb}>
                      {nb}
                    </option>
                  ))}
                  <option value="__new_notebook__">+ 新建笔记本</option>
                </select>
              </div>
            ) : selectedNotebook.trim() ? (
              <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-ink" title={selectedNotebook}>
                {selectedNotebook}
              </h1>
            ) : (
              <button
                type="button"
                className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm font-semibold text-brand ring-1 ring-brand/30 transition-colors hover:bg-brand/5`}
                onClick={() => {
                  setNotebookModalError("");
                  setNewNotebookName("");
                  setShowNotebookModal(true);
                }}
              >
                + 新建笔记本
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3 lg:h-[min(100dvh-5.5rem,900px)] lg:max-h-[min(100dvh-5.5rem,900px)] lg:flex-row lg:items-stretch lg:gap-4 lg:overflow-hidden">
            <section
              className={`flex shrink-0 flex-col overflow-hidden rounded-3xl border border-line/70 bg-fill/15 shadow-soft lg:min-h-0 lg:h-full ${
                sourcesPanelCollapsed
                  ? "w-full max-lg:min-h-0 lg:w-[3.25rem] lg:min-w-[3.25rem] lg:max-w-[3.25rem] p-2"
                  : "w-full p-4 lg:w-[22.5rem] lg:min-w-[22.5rem] lg:max-w-[25.5rem] xl:w-[27rem] xl:max-w-[27rem]"
              }`}
              aria-label="来源"
            >
              {sourcesPanelCollapsed ? (
                <button
                  type="button"
                  className="flex w-full flex-1 flex-row items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface/60 lg:min-h-0 lg:flex-col lg:items-center lg:justify-start lg:gap-5 lg:px-1 lg:py-8"
                  aria-label="向右展开来源"
                  title="展开来源"
                  onClick={() => setSourcesPanelCollapsed(false)}
                >
                  <svg
                    width="20"
                    height="20"
                    className="shrink-0 text-muted"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M9 4v16" />
                  </svg>
                  <span className="text-sm font-semibold text-ink lg:text-xs lg:[writing-mode:vertical-rl]">来源</span>
                  <svg
                    width="18"
                    height="18"
                    className="shrink-0 text-ink"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ) : (
                <>
                  {notebooks.length === 0 ? (
                    <div className="mb-3 shrink-0 rounded-xl border border-brand/35 bg-gradient-to-br from-brand/[0.08] to-brand/[0.06] px-3 py-3 shadow-soft ring-1 ring-brand/10">
                      <p className="text-xs font-semibold text-ink">新建笔记本</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">创建后可添加资料并在右侧使用。</p>
                      <button
                        type="button"
                        className="mt-2.5 w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground shadow-soft transition-opacity hover:opacity-95"
                        onClick={() => {
                          setNotebookModalError("");
                          setNewNotebookName("");
                          setShowNotebookModal(true);
                        }}
                      >
                        新建笔记本
                      </button>
                    </div>
                  ) : null}
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/50 pb-3">
                    <h2 className="text-lg font-semibold tracking-tight text-ink">来源</h2>
                    <button
                      type="button"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface/80 hover:text-ink"
                      aria-expanded
                      aria-label="收起来源（向左折叠）"
                      title="向左收起"
                      onClick={() => setSourcesPanelCollapsed(true)}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                </div>
                <button
                  type="button"
                  disabled={notebooks.length === 0 || Boolean(sharedBrowse)}
                  title={
                    sharedBrowse
                      ? "分享浏览模式下不可添加资料"
                      : notebooks.length === 0
                        ? "请先新建笔记本"
                        : undefined
                  }
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line/90 bg-surface py-2.5 text-sm font-medium text-ink shadow-soft transition-colors hover:border-brand/35 hover:bg-fill/50 disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => {
                    setImportUrlError("");
                    setShowAddNoteModal(true);
                  }}
                >
                  <span className="text-base leading-none text-brand">+</span>
                  添加笔记
                </button>

                  <div className="mt-3 min-h-0 max-h-[min(100dvh-12rem,520px)] flex-1 overflow-y-auto overflow-x-hidden pr-0.5 lg:max-h-none">
                <p className="text-[11px] leading-snug text-muted">
                  {notebooks.length === 0
                    ? "创建笔记本后即可添加资料。"
                    : `已选 ${draftSelectedNoteIds.length} 条 · 本页 ${stats.total} 条${hasMoreNotes ? " · 仍有更多" : ""}`}
                </p>
                {notesSorted.length > 0 ? (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-ink hover:bg-surface/70">
                    <input
                      ref={selectAllOnPageInputRef}
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand"
                      checked={allNotesOnPageSelected}
                      onChange={onSelectAllOnPageChange}
                      aria-label="选择全部"
                    />
                    选择全部
                  </label>
                ) : null}
                {loading ? <p className="mt-2 text-sm text-muted">加载中…</p> : null}
                <div className="mt-2 space-y-1.5">
                  {notesSorted.map((n) => (
                    (() => {
                      const stageInfo = deriveSourcePreprocessStage(n);
                      const preReady = isSourceUsable(n);
                      return (
                    <div
                      key={n.noteId}
                      data-note-id={n.noteId}
                      className={`rounded-xl border p-2.5 shadow-soft transition-colors ${
                        preReady
                          ? "border-line/80 bg-surface/95"
                          : "border-line/55 bg-fill/35 opacity-80"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-1">
                            <span className="shrink-0 rounded bg-fill px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted">
                              {noteExtLabel(n.ext)}
                            </span>
                            <button
                              type="button"
                              className={`min-w-0 truncate text-left text-sm font-medium underline-offset-2 hover:underline ${
                                preReady ? "text-ink" : "text-muted"
                              }`}
                              onClick={() => void openPreview(n.noteId)}
                              title="查看来源内容"
                            >
                              {n.title || n.noteId}
                            </button>
                            {n.parseState === "failed" || n.sourceReady === false ? (
                              <span
                                className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-warning-soft text-warning-ink"
                                title={n.sourceHint || "来源尚未可用"}
                              >
                                来源待就绪
                              </span>
                            ) : null}
                            {n.citeState === "unavailable" ? (
                              <span
                                className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-warning-soft text-warning-ink"
                                title="引用不可用"
                              >
                                引用不可用
                              </span>
                            ) : null}
                            {freshNoteIds.includes(n.noteId) ? (
                              <span
                                className="inline-flex shrink-0 text-warning"
                                title="刚加入，可作播客资料"
                                role="img"
                                aria-label="刚加入的资料"
                              >
                                <FreshNoteSparkleIcon />
                              </span>
                            ) : null}
                            {n.retrieveState === "failed" || n.ragIndexError ? (
                              <span
                                className="shrink-0 rounded px-1 py-0 text-[9px] font-medium bg-danger-soft text-danger-ink"
                                title={n.ragIndexError || "检索索引失败"}
                              >
                                检索失败
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`mt-1.5 rounded-lg border px-2 py-1.5 ${
                              preReady ? "border-line/60 bg-fill/30" : "border-line/45 bg-surface/45"
                            }`}
                          >
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="font-medium text-muted">预处理</span>
                              <span
                                className={`rounded px-1 py-0 text-[9px] font-medium ${
                                  stageInfo.stage === "可问答"
                                    ? "bg-success-soft text-success-ink"
                                    : "bg-warning-soft text-warning-ink"
                                }`}
                              >
                                {stageInfo.stage}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-muted">{stageInfo.nextAction}</p>
                            {(n.preprocessTags?.length || n.preprocessEntities?.length) ? (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {(n.preprocessTags || []).slice(0, 6).map((t) => (
                                  <span
                                    key={`tag-${n.noteId}-${t}`}
                                    className="rounded bg-brand/10 px-1 py-0 text-[10px] font-medium text-brand"
                                  >
                                    #{t}
                                  </span>
                                ))}
                                {(n.preprocessEntities || []).slice(0, 4).map((e) => (
                                  <span
                                    key={`ent-${n.noteId}-${e}`}
                                    className="rounded bg-fill px-1 py-0 text-[10px] text-muted"
                                  >
                                    {e}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-0.5">
                          <div className="relative" data-note-overflow-menu>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-track"
                            aria-label="更多"
                            aria-expanded={noteMenuOpenId === n.noteId}
                            onClick={() => setNoteMenuOpenId((x) => (x === n.noteId ? null : n.noteId))}
                          >
                            ⋯
                          </button>
                          {noteMenuOpenId === n.noteId ? (
                            <div className="absolute right-0 top-full z-10 mt-0.5 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card">
                              {sharedBrowse ? null : (
                                <>
                                  <button
                                    type="button"
                                    className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                                    onClick={() => {
                                      setRenameNoteId(n.noteId);
                                      setRenameNoteTitle(n.title || "");
                                      setNoteMenuOpenId(null);
                                    }}
                                  >
                                    改名
                                  </button>
                                  <button
                                    type="button"
                                    className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                                    onClick={() => {
                                      setRenameNoteId(null);
                                      setNoteMenuOpenId(null);
                                      void confirmDeleteNote(n.noteId);
                                    }}
                                  >
                                    删除
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                          </div>
                          <input
                            type="checkbox"
                            className={`mt-1.5 h-4 w-4 ${preReady ? "accent-brand" : "accent-muted"}`}
                            checked={draftSelectedNoteIds.includes(n.noteId)}
                            onChange={() => toggleDraftNote(n.noteId)}
                            disabled={!preReady}
                            aria-label={`将「${n.title || n.noteId}」纳入资料`}
                          />
                        </div>
                      </div>
                      {renameNoteId === n.noteId ? (
                        <div className="mt-2 border-t border-line pt-2">
                          <InlineTextPrompt
                            open
                            title="重命名笔记"
                            value={renameNoteTitle}
                            onChange={setRenameNoteTitle}
                            onSubmit={() => void saveRenameNote()}
                            onCancel={() => setRenameNoteId(null)}
                            className="border-line bg-canvas/80"
                          />
                        </div>
                      ) : null}
                    </div>
                      );
                    })()
                  ))}
                  {!loading && notesSorted.length === 0 ? (
                    <EmptyState
                      title="这个笔记本里还没有笔记"
                      description="「添加笔记」导入；勾选纳入资料。"
                      className="mt-2 border-none bg-transparent py-8"
                    />
                  ) : null}
                  {!loading && (notePage > 1 || hasMoreNotes) ? (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                        disabled={notePage <= 1}
                        onClick={() => setNotePage((p) => Math.max(1, p - 1))}
                      >
                        上一页
                      </button>
                      <span className="text-muted">第 {notePage} 页</span>
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-ink disabled:opacity-40"
                        disabled={!hasMoreNotes}
                        onClick={() => setNotePage((p) => p + 1)}
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
                </>
              )}
            </section>

            <div
              className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${
                sourcesPanelCollapsed || appNavCollapsed ? "w-full" : "justify-center"
              }`}
            >
            <section
              className={`flex min-h-0 h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-line/70 bg-fill/15 p-4 shadow-soft ${
                sourcesPanelCollapsed || appNavCollapsed ? "max-w-none" : "max-w-[min(100%,38rem)]"
              }`}
              role="region"
              aria-label="对话"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/50 pb-3">
                <h2 className="text-lg font-semibold tracking-tight text-ink">对话</h2>
                <span className="text-muted opacity-60" aria-hidden>
                  ⋮
                </span>
              </div>

              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {notesAskError ? (
                  <div className="shrink-0 space-y-1 text-xs text-danger-ink" role="alert">
                    <p className="whitespace-pre-wrap break-words">{notesAskError}</p>
                  </div>
                ) : null}
                <div
                  ref={notesAskScrollRef}
                  className="h-[min(50vh,420px)] max-h-[min(50vh,420px)] min-h-[200px] w-full min-w-0 shrink-0 overflow-y-auto rounded-xl border border-line/80 bg-surface/80 p-3.5"
                >
                  {notesAskMessages.length === 0 ? (
                    <p className="text-xs text-muted">勾选左侧资料后即可提问</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {notesAskMessages.map((m) => (
                        <div
                          key={m.id}
                          className={
                            m.role === "user" ? "flex justify-end" : "flex w-full min-w-0 justify-start"
                          }
                        >
                            {m.role === "user" ? (
                              notesAskLastUserMessageId === m.id ? (
                              <div className="group/user-msg flex max-w-[min(96%,28rem)] min-w-0 items-start gap-2">
                                <div className="pointer-events-none flex shrink-0 flex-row items-center gap-0.5 self-start pt-1.5 opacity-0 transition-opacity duration-150 group-hover/user-msg:pointer-events-auto group-hover/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto group-focus-within/user-msg:opacity-100">
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-brand/10 hover:text-ink"
                                      title="复制问题"
                                      aria-label="复制问题"
                                      disabled={!(m.content || "").trim()}
                                      onClick={() => void copyNotesAskAnswer(m.content)}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M6 11c0-1.1.9-2 2-2h7a2 2 0 012 2v9a2 2 0 01-2 2H8a2 2 0 01-2-2v-9z"
                                          stroke="currentColor"
                                          strokeWidth="1.75"
                                        />
                                        <path
                                          d="M9 7V6a2 2 0 012-2h7a2 2 0 012 2v9a2 2 0 01-2 2h-2"
                                          stroke="currentColor"
                                          strokeWidth="1.75"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition hover:bg-brand/10 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                                      title="编辑问题（将中止当前生成并回填输入框）"
                                      aria-label="编辑问题"
                                      disabled={sharedBrowse?.access === "read_only"}
                                      onClick={() => beginEditNotesAskUserTurn(m.id, m.content)}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L8 18l-4 1 1-4L16.5 3.5z"
                                          stroke="currentColor"
                                          strokeWidth="1.75"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    </button>
                                  </div>
                                <div className="min-w-0 flex-1 rounded-2xl bg-brand/12 px-3 py-2 text-sm text-ink shadow-sm">
                                  <p className="min-w-0 whitespace-pre-wrap break-words">{m.content}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="max-w-[min(92%,24rem)] min-w-0 rounded-2xl bg-brand/12 px-3 py-2 text-sm text-ink shadow-sm">
                                <p className="min-w-0 whitespace-pre-wrap break-words">{m.content}</p>
                              </div>
                            )
                            ) : (
                              <div className="w-full min-w-0 max-w-full px-0 py-1 text-sm leading-relaxed text-ink">
                            {m.streaming &&
                              !(m.content || "").trim() &&
                              !(m.streamingReasoning || "").trim() ? (
                              <p className="text-muted">思考中…</p>
                            ) : (
                              <div className="min-w-0">
                                {m.streaming && (m.streamingReasoning || "").trim() ? (
                                  <div className="mb-2 rounded-lg border border-line/60 bg-fill/35 px-2.5 py-2">
                                    <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink/75">
                                      {m.streamingReasoning}
                                    </p>
                                  </div>
                                ) : null}
                                <NotesAskAnswerDisplay
                                  text={m.content}
                                  sources={m.sources}
                                  webSources={m.webSources}
                                  onOpenSourceFromCitation={(p) => {
                                    void openPreview(p.noteId, { highlightText: p.excerpt });
                                  }}
                                />
                                {!m.streaming &&
                                m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX) &&
                                (m.hintSuggestions?.length ?? 0) > 0 ? (
                                  <div className="mt-2 flex flex-col gap-1.5">
                                    <p className="text-[11px] font-medium text-muted">试试这样问（点击填入输入框）</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {m.hintSuggestions!.map((q) => (
                                        <button
                                          key={q}
                                          type="button"
                                          className="max-w-full rounded-lg border border-brand/35 bg-brand/[0.06] px-2.5 py-1.5 text-left text-[11px] leading-snug text-ink transition hover:bg-brand/10"
                                          title={q}
                                          onClick={() => {
                                            setNotesAskQuestion(q);
                                            window.setTimeout(() => notesAskTextareaRef.current?.focus(), 0);
                                          }}
                                        >
                                          {q}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                                {!m.streaming &&
                                (m.content || "").trim() &&
                                !m.id.startsWith(NOTES_ASK_HINTS_BOOT_PREFIX) ? (
                                  <div className="mt-3 flex flex-wrap items-center gap-0.5 border-t border-line/40 pt-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink"
                                      title="复制"
                                      aria-label="复制"
                                      onClick={() => void copyNotesAskAnswer(m.content)}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M6 11c0-1.1.9-2 2-2h7a2 2 0 012 2v9a2 2 0 01-2 2H8a2 2 0 01-2-2v-9z"
                                          stroke="currentColor"
                                          strokeWidth="1.75"
                                        />
                                        <path
                                          d="M9 7V6a2 2 0 012-2h7a2 2 0 012 2v9a2 2 0 01-2 2h-2"
                                          stroke="currentColor"
                                          strokeWidth="1.75"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink"
                                      title="分享"
                                      aria-label="分享"
                                      onClick={() => void shareNotesAskAnswer(m.content)}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                                        <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                                        <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                                        <path
                                          d="M8.2 13.6l6.6 3.2M15.8 7.2L9.2 10.4"
                                          stroke="currentColor"
                                          strokeWidth="1.5"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-fill hover:text-ink disabled:opacity-40"
                                      title="新增为笔记"
                                      aria-label="新增为笔记"
                                      disabled={Boolean(sharedBrowse) || notesAskNoteBusyId === m.id}
                                      onClick={() => void saveAskAnswerAsNote(m.content, m.id)}
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                        <path
                                          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                                          stroke="currentColor"
                                          strokeWidth="1.5"
                                          strokeLinejoin="round"
                                        />
                                        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                                        <path d="M12 18v-6M9 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                      </svg>
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            )}
                              </div>
                            )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                  <button
                    type="button"
                    disabled={sharedBrowse?.access === "read_only"}
                    onClick={() => openPodcastFlow()}
                    className="inline-flex min-h-[2.75rem] w-full min-w-0 flex-none flex-row items-center gap-2.5 rounded-xl border border-brand/35 bg-gradient-to-br from-brand/15 to-brand/[0.06] px-3 py-2 text-left shadow-soft transition hover:brightness-[1.03] active:scale-[0.98] enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[10.125rem]"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-[1.125rem] leading-none"
                      aria-hidden
                    >
                      🎧
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-tight text-ink">生成播客</span>
                  </button>
                  <button
                    type="button"
                    disabled={sharedBrowse?.access === "read_only"}
                    onClick={() => openArticleFlow()}
                    className="inline-flex min-h-[2.75rem] w-full min-w-0 flex-none flex-row items-center gap-2.5 rounded-xl border border-success/35 bg-gradient-to-br from-success-soft/90 to-success/[0.08] px-3 py-2 text-left shadow-soft transition hover:brightness-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:min-w-[10.125rem]"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-soft/50 text-[1.125rem] leading-none"
                      aria-hidden
                    >
                      📝
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-tight text-ink">生成文章</span>
                  </button>
                </div>
                <div className="flex min-w-0 shrink-0 flex-col gap-2">
                  {notesAskStreamInfo ? (
                    <p
                      role="status"
                      className="rounded-lg border border-amber-500/35 bg-amber-500/[0.08] px-2.5 py-1.5 text-[11px] leading-snug text-amber-950 dark:text-amber-100"
                    >
                      {notesAskStreamInfo}
                    </p>
                  ) : null}
                  <div
                    className={`flex shrink-0 items-end gap-2 rounded-2xl border border-line/90 px-3 py-2 shadow-soft ring-1 ring-line/60 ${
                      draftSelectedNoteIds.length === 0 ? "bg-fill/50" : "bg-surface"
                    }`}
                  >
                  <textarea
                    ref={notesAskTextareaRef}
                    className="max-h-32 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-muted"
                    placeholder={
                      draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "输入问题…"
                    }
                    value={notesAskQuestion}
                    onChange={(e) => setNotesAskQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      if (e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      if (
                        notesAskBusy ||
                        draftSelectedNoteIds.length === 0 ||
                        !notesAskQuestion.trim()
                      ) {
                        return;
                      }
                      void submitNotesAsk();
                    }}
                    disabled={notesAskBusy || draftSelectedNoteIds.length === 0}
                    aria-label={
                      draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "向资料提问"
                    }
                    title={draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : undefined}
                    rows={1}
                  />
                  <span className="mb-1 shrink-0 rounded-full bg-fill px-2 py-0.5 text-[10px] font-medium text-muted tabular-nums">
                    {draftSelectedNoteIds.length} 条
                  </span>
                  {notesAskBusy ? (
                    <button
                      type="button"
                      className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-amber-600/55 bg-amber-500/[0.18] text-amber-950 shadow-sm transition hover:bg-amber-500/[0.28] active:scale-[0.96] dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-50"
                      title="停止生成"
                      aria-label="停止生成"
                      onClick={() => notesAskStreamAbortRef.current?.abort()}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-soft transition-opacity disabled:opacity-40"
                      disabled={draftSelectedNoteIds.length === 0 || !notesAskQuestion.trim()}
                      title={
                        draftSelectedNoteIds.length === 0 ? NOTES_ASK_SOURCE_REQUIRED : "提问"
                      }
                      aria-label="发送提问"
                      onClick={() => void submitNotesAsk()}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M5 12h14M13 8l6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                  </div>
                  {NOTES_ASK_DEBUG_BODY_ENABLED ? (
                    <div className="rounded-xl border border-amber-500/45 bg-amber-500/[0.08] px-3 py-2 text-xs leading-snug text-ink">
                      <div className="mb-1.5 font-semibold text-amber-950 dark:text-amber-100">
                        调试：问答 POST body（NEXT_PUBLIC_NOTES_ASK_DEBUG_BODY=1）
                      </div>
                      {!notesAskDebugClient ? (
                        <p className="text-[11px] text-muted">正在解析请求 URL…</p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <p className="text-[11px] text-muted">
                            与当前表单一致：流式含 <code className="text-[10px]">question</code> 与{" "}
                            <code className="text-[10px]">note_ids</code>。浏览器已登录时会自动带 Cookie；curl 请把{" "}
                            <code className="text-[10px]">fym_session=PASTE</code> 换成真实值。
                          </p>
                          <div>
                            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium">POST /api/notes/ask/stream</span>
                              {notesAskDebugPack.streamReady ? (
                                <span className="text-[11px] text-success-ink">可发送</span>
                              ) : (
                                <span className="text-[11px] text-rose-600">未满足发送条件（笔记本 / 资料 / 问题）</span>
                              )}
                              <button
                                type="button"
                                className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[11px] hover:bg-fill"
                                onClick={() => void copyNotesAskDebug(notesAskDebugPack.streamJsonPretty, "stream")}
                              >
                                {notesAskDebugCopied === "stream" ? "已复制 JSON" : "复制 JSON"}
                              </button>
                              <button
                                type="button"
                                disabled={!notesAskDebugCurls.streamCurl}
                                className="rounded-md border border-line/80 bg-surface px-2 py-0.5 text-[11px] hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => void copyNotesAskDebug(notesAskDebugCurls.streamCurl, "curlStream")}
                              >
                                {notesAskDebugCopied === "curlStream" ? "已复制 curl" : "复制 curl"}
                              </button>
                            </div>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-fill/90 p-2 font-mono text-[11px] text-ink">
                              {notesAskDebugPack.streamJsonPretty}
                            </pre>
                            <p className="mt-1 break-all font-mono text-[10px] text-muted">{notesAskDebugCurls.streamUrl}</p>
                            {notesAskDebugCurls.streamCurl ? (
                              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-fill/50 p-2 font-mono text-[10px] text-muted">
                                {notesAskDebugCurls.streamCurl}
                              </pre>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            </div>

          </div>
          <section className="mt-6 rounded-3xl border border-line/70 bg-fill/15 p-3 shadow-soft lg:mt-8">
            <div className="flex items-center justify-between gap-2 border-b border-line/50 pb-3">
              <h2 className="text-lg font-semibold tracking-tight text-ink">我的作品</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:bg-fill"
                  onClick={() => setWorksPanelExpanded((v) => !v)}
                >
                  {worksPanelExpanded ? "收起" : "展开"}
                </button>
                <a
                  href="/works"
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-brand hover:bg-fill"
                >
                  查看全部
                </a>
              </div>
            </div>
            <div
              className={`mt-4 overflow-y-auto overflow-x-hidden transition-[max-height] duration-200 ${
                worksPanelExpanded ? "max-h-[min(92vh,1040px)]" : "max-h-[min(46vh,520px)]"
              }`}
            >
              <PodcastWorksGallery
                works={podcastWorks}
                loading={podcastWorksLoading}
                fetchError={podcastWorksError}
                onDismissError={() => setPodcastWorksError("")}
                onWorkDeleted={() => void fetchPodcastWorks()}
                variant="all"
              />
            </div>
          </section>
        </>
      )}

      {showAddNoteModal ? (
        <div
          className="fym-workspace-scrim z-[520] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-note-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !importBusy && !uploading) setShowAddNoteModal(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-modal"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="add-note-title" className="text-base font-semibold text-ink">
                添加笔记
              </h2>
              <button
                type="button"
                className="text-sm text-muted hover:text-ink"
                onClick={() => !importBusy && !uploading && setShowAddNoteModal(false)}
                disabled={importBusy || uploading}
              >
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-2">
              <label className="block text-xs text-ink">
                网页链接
                <input
                  className={`mt-1 block w-full ${inputCls}`}
                  placeholder="https://..."
                  value={importUrl}
                  onChange={(e) => {
                    setImportUrl(e.target.value);
                    if (importUrlError) setImportUrlError("");
                  }}
                  aria-invalid={Boolean(importUrlError)}
                  aria-describedby={importUrlError ? "import-url-err" : undefined}
                />
                {importUrlError ? (
                  <p id="import-url-err" className="mt-1 whitespace-pre-wrap text-xs font-medium text-danger" role="alert">
                    {importUrlError}
                  </p>
                ) : null}
              </label>
              <button
                type="button"
                className="w-full rounded-lg bg-mint px-3 py-2 text-sm text-mint-foreground shadow-soft hover:bg-mint/90 disabled:opacity-50"
                disabled={importBusy}
                onClick={() => void submitUrlImport()}
              >
                {importBusy ? "导入中…" : "导入链接"}
              </button>
            </div>
            <div className="my-4 border-t border-line" />
            <div className="space-y-2">
              <p className="text-xs text-muted">上传本地文件（支持 txt/md/pdf/doc/docx/epub/html 与图片；图片会尝试 OCR 抽正文）</p>
              <input
                ref={addNoteFileRef}
                type="file"
                accept=".txt,.md,.markdown,.pdf,.doc,.docx,.epub,.html,.htm,.xhtml,.png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="hidden"
                onChange={(e) => {
                  void uploadFile(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="w-full rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
                disabled={uploading}
                title={uploading ? "上传过程中请稍候" : undefined}
                onClick={() => addNoteFileRef.current?.click()}
              >
                {uploading ? (uploadProgress != null && uploadProgress < 100 ? `上传中 ${uploadProgress}%` : "处理中…") : "选择文件"}
              </button>
              {uploading && uploadProgress != null ? (
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-brand transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-[11px] text-muted">{uploadProgress < 100 ? "上传中…" : "处理中…"}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showNotebookCoverModal && notebookCoverModalTarget.trim() ? (
        <div
          className="fym-workspace-scrim z-[525] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notebook-cover-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !notebookCoverModalBusy) {
              setShowNotebookCoverModal(false);
              setNotebookCoverModalErr("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-modal"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id="notebook-cover-title" className="text-base font-semibold text-ink">
              上传封面
            </h2>
            <p className="mt-1 truncate text-xs text-muted" title={notebookCoverModalTarget}>
              笔记本：{notebookCoverModalTarget}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              仅上传图会作为卡片背景；未上传时使用随机主题色与图标。建议 2MB 内常见图片格式。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={notebookCoverModalBusy}
                className="rounded-lg border border-line bg-fill/40 px-3 py-2 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
                onClick={() => notebookCoverFileRef.current?.click()}
              >
                选择图片…
              </button>
              {notebookCoversByName[notebookCoverModalTarget]?.hasUploadThumb ? (
                <button
                  type="button"
                  disabled={notebookCoverModalBusy}
                  className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-fill disabled:opacity-50"
                  onClick={() => void patchNotebookCoverApi(notebookCoverModalTarget, { coverMode: "auto" })}
                >
                  移除封面图
                </button>
              ) : null}
            </div>
            <input
              ref={notebookCoverFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadNotebookCoverFileApi(notebookCoverModalTarget, f);
              }}
            />
            {notebookCoverModalErr ? (
              <p className="mt-3 text-xs text-danger-ink" role="alert">
                {notebookCoverModalErr}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-line bg-fill/40 px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
                disabled={notebookCoverModalBusy}
                onClick={() => {
                  setShowNotebookCoverModal(false);
                  setNotebookCoverModalErr("");
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showShareNotebookModal ? (
        <div
          className="fym-workspace-scrim z-[520] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-notebook-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !shareModalBusy) {
              setShowShareNotebookModal(false);
              setShareModalError("");
              setShareCopyHint("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-modal"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id="share-notebook-title" className="text-base font-semibold text-ink">
              分享
            </h2>
            <p className="mt-1 truncate text-xs text-muted" title={shareTargetNotebook}>
              笔记本：{shareTargetNotebook || "—"}
            </p>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              选择分享方式后点击「分享」生效。未登录访客可打开链接查看资料与来源内容；基于来源的创作需访客登录。已开启分享后可复制链接。
            </p>
            <fieldset className="mt-4 space-y-3 rounded-xl border border-line/80 p-3">
              <legend className="px-1 text-xs font-semibold text-ink">分享方式</legend>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-fill/50">
                <input
                  type="radio"
                  name="notebook-share-access"
                  className="mt-0.5 accent-brand"
                  checked={shareFormAccess === "read_only"}
                  onChange={() => setShareFormAccess("read_only")}
                  disabled={shareModalBusy}
                />
                <span>
                  <span className="text-sm font-medium text-ink">只读</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    访客可查看来源与来源内容、向资料提问；不可添加或修改笔记，不可基于来源生成播客或长文。
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-fill/50">
                <input
                  type="radio"
                  name="notebook-share-access"
                  className="mt-0.5 accent-brand"
                  checked={shareFormAccess === "edit"}
                  onChange={() => setShareFormAccess("edit")}
                  disabled={shareModalBusy}
                />
                <span>
                  <span className="text-sm font-medium text-ink">可创作</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    在只读能力基础上，允许登录访客使用所选来源生成播客或文章（写入访客自己的作品，不改变你的笔记）。
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-line bg-fill/50 px-3 py-2 text-xs font-medium text-ink hover:bg-fill disabled:opacity-50"
                disabled={
                  shareModalBusy ||
                  !(typeof user?.user_id === "string" && user.user_id.trim()) ||
                  !notebookSharingByName[shareTargetNotebook]?.isPublic
                }
                title={
                  notebookSharingByName[shareTargetNotebook]?.isPublic
                    ? undefined
                    : "请先分享后再复制链接"
                }
                onClick={() => void copyNotebookShareLink()}
              >
                复制分享链接
              </button>
              {shareCopyHint ? (
                <span className="text-[11px] text-muted" role="status">
                  {shareCopyHint}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[11px] text-muted">
              累计浏览{" "}
              <span className="font-medium text-ink">
                {notebookSharingByName[shareTargetNotebook]?.viewCount ?? 0}
              </span>
              （从热门列表进入时增加；同一登录账号 24 小时内对同一本重复打开仅计一次；本人打开不计）
            </p>
            {shareModalError ? (
              <p className="mt-2 text-xs text-danger-ink" role="alert">
                {shareModalError}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-sm"
                disabled={shareModalBusy}
                onClick={() => {
                  if (!shareModalBusy) {
                    setShowShareNotebookModal(false);
                    setShareModalError("");
                    setShareCopyHint("");
                  }
                }}
              >
                取消
              </button>
              {notebookSharingByName[shareTargetNotebook]?.isPublic ? (
                <button
                  type="button"
                  className="rounded-lg border border-line bg-fill/40 px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
                  disabled={shareModalBusy}
                  onClick={() => void submitStopNotebookSharing()}
                >
                  {shareModalBusy ? "处理中…" : "取消分享"}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
                disabled={shareModalBusy}
                onClick={() => void submitNotebookSharing()}
              >
                {shareModalBusy ? "分享中…" : "分享"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showNotebookModal ? (
        <SmallPromptModal
          open
          title="新建笔记本"
          value={newNotebookName}
          onChange={(v) => {
            setNotebookModalError("");
            setNewNotebookName(v);
          }}
          onSubmit={() => void createNotebook()}
          onCancel={() => {
            setShowNotebookModal(false);
            setNewNotebookName("");
            setNotebookModalError("");
          }}
          placeholder="笔记本名称"
          submitLabel="创建"
          busy={busy}
          error={notebookModalError || null}
        />
      ) : null}
      {showRenameNotebook ? (
        <SmallPromptModal
          open
          title={`重命名笔记本（从「${renameNotebookOld}」改为）`}
          value={renameNotebookNew}
          onChange={setRenameNotebookNew}
          onSubmit={() => void renameNotebookSubmit()}
          onCancel={() => setShowRenameNotebook(false)}
          placeholder="新名称"
          submitLabel="保存"
          busy={busy}
        />
      ) : null}
      {deleteNotebookConfirm ? (
        <InlineConfirmBar
          open
          message={`确认删除笔记本「${deleteNotebookTarget || selectedNotebook}」？其下笔记将永久删除（不可从笔记回收站恢复）；由该笔记本资料生成的播客与文章将移入作品回收站。`}
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          closeOnOutsideClick={false}
          onConfirm={() => void confirmDeleteNotebook()}
          onCancel={() => {
            setDeleteNotebookConfirm(false);
            setDeleteNotebookTarget(null);
          }}
          className="border-danger/35 bg-danger-soft"
        />
      ) : null}

      {showPodcastGenreModal ? (
        <div
          className="fym-workspace-scrim z-[520] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="genre-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setShowPodcastGenreModal(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-4 shadow-modal"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 id="genre-title" className="text-base font-semibold text-ink">
              选择体裁
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(Object.keys(PODCAST_ROOM_PRESETS) as PodcastRoomPresetKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="rounded-xl border border-line bg-fill/90 p-3 text-left transition-colors hover:border-brand/50 hover:bg-surface"
                  onClick={() => {
                    setPodcastRoomPresetKey(k);
                    setShowPodcastGenreModal(false);
                    setShowPodcastRoomModal(true);
                  }}
                >
                  <span className="text-sm font-semibold text-ink">{PODCAST_ROOM_PRESETS[k].label}</span>
                  <span className="mt-1 block text-[10px] text-muted">{k}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => setShowPodcastGenreModal(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <NotesPodcastRoomModal
        open={showPodcastRoomModal}
        onClose={() => setShowPodcastRoomModal(false)}
        notebookName={selectedNotebook}
        lockedNoteIds={draftSelectedNoteIds}
        noteTitleById={noteTitleById}
        presetKey={podcastRoomPresetKey}
        onPodcastJobCreated={onPodcastJobCreated}
        externalPrompt={notesStudioPrompt}
        onExternalPromptChange={setNotesStudioPrompt}
        notesSourceOwnerUserId={
          sharedBrowse?.access === "edit" && sharedBrowse.ownerUserId ? sharedBrowse.ownerUserId : null
        }
      />

      {showArticleModal ? (
        <div
          className="fym-workspace-scrim z-[520] flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="article-modal-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && !draftBusy) {
              setShowArticleModal(false);
              setArticleModalStep("pick");
            }
          }}
        >
          <div
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-modal"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {articleModalStep === "pick" ? (
              <>
                <h2 id="article-modal-title" className="text-base font-semibold text-ink">
                  选择文章体裁
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(Object.keys(ART_KIND_PRESETS) as ArtKindKey[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="rounded-xl border border-line bg-fill/90 p-3 text-left transition-colors hover:border-brand/50 hover:bg-surface"
                      onClick={() => pickArticleKind(k)}
                    >
                      <span className="text-sm font-semibold text-ink">{ART_KIND_PRESETS[k].label}</span>
                      <span className="mt-1 block text-[10px] text-muted">{k}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                    onClick={() => {
                      setShowArticleModal(false);
                      setArticleModalStep("pick");
                    }}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-ink">生成文章</h2>
                    <p className="mt-1 text-xs text-muted">{ART_KIND_PRESETS[artKind].label}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-brand hover:underline"
                    onClick={() => setArticleModalStep("pick")}
                  >
                    ← 重选体裁
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-ink">
                    语言
                    <select
                      className={`mt-1 block w-full ${inputCls}`}
                      value={artLang}
                      onChange={(e) => setArtLang(e.target.value)}
                    >
                      {LANG_OPTIONS_ART.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-ink">
                    目标字数（默认 {NOTES_ART_TARGET_CHARS_DEFAULT}，{NOTES_ART_TARGET_CHARS_MIN}–
                    {NOTES_ART_TARGET_CHARS_MAX}；实际上限以套餐为准）
                    <input
                      type="number"
                      min={NOTES_ART_TARGET_CHARS_MIN}
                      max={NOTES_ART_TARGET_CHARS_MAX}
                      className={`mt-1 block w-full ${inputCls}`}
                      value={artCharsInput}
                      onChange={(e) => setArtCharsInput(e.target.value)}
                      onBlur={commitArtCharsInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitArtCharsInput();
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="mt-2">
                  <label className="block text-[11px] text-muted">
                    拖动调整字数
                    <div className="mt-1.5 flex items-center gap-3">
                      <input
                        type="range"
                        className="h-2 min-w-0 flex-1 cursor-pointer accent-brand"
                        min={NOTES_ART_TARGET_CHARS_MIN}
                        max={NOTES_ART_TARGET_CHARS_MAX}
                        step={NOTES_ART_TARGET_CHARS_SLIDER_STEP}
                        value={Math.min(
                          NOTES_ART_TARGET_CHARS_MAX,
                          Math.max(NOTES_ART_TARGET_CHARS_MIN, artChars)
                        )}
                        aria-valuemin={NOTES_ART_TARGET_CHARS_MIN}
                        aria-valuemax={NOTES_ART_TARGET_CHARS_MAX}
                        aria-valuenow={artChars}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const clamped = Math.min(
                            NOTES_ART_TARGET_CHARS_MAX,
                            Math.max(NOTES_ART_TARGET_CHARS_MIN, Math.round(v))
                          );
                          setArtChars(clamped);
                          setArtCharsInput(String(clamped));
                        }}
                      />
                      <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-ink">
                        {artChars} 字
                      </span>
                    </div>
                  </label>
                  <p className="mt-1 text-[10px] leading-snug text-muted">
                    滑块步进 {NOTES_ART_TARGET_CHARS_SLIDER_STEP}；需精确值或超出滑块手感时，请用上方数字框。
                  </p>
                </div>
                <label className="mt-3 block text-xs text-ink">
                  核心问题（可选）
                  <input
                    type="text"
                    className={`mt-1 block w-full ${inputCls}`}
                    value={artCoreQuestion}
                    onChange={(e) => setArtCoreQuestion(e.target.value)}
                    placeholder="全文须围绕回答的一个问题，例如：……"
                  />
                </label>
                <label className="mt-3 block text-xs text-ink">
                  AI 提词（可编辑）
                  <textarea
                    className={`mt-1 min-h-32 w-full ${inputCls}`}
                    value={artText}
                    onChange={(e) => setArtText(e.target.value)}
                    placeholder="将依据所选笔记与上述提词生成文章。"
                  />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-2 text-sm"
                    disabled={draftBusy}
                    onClick={() => {
                      if (!draftBusy) {
                        setShowArticleModal(false);
                        setArticleModalStep("pick");
                      }
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
                    disabled={draftBusy}
                    onClick={() => void submitArticleDraft()}
                  >
                    {draftBusy ? "创建中…" : "生成节目底稿"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div
          className="fym-workspace-scrim z-[520] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-preview-title"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false);
          }}
        >
          <div className="max-h-[min(92vh,820px)] w-full max-w-5xl overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
            <NoteMarkdownPreview
              title={previewTitle || "来源内容"}
              filteredText={filteredPreview}
              loading={previewLoading}
              truncated={previewTruncated}
              statusLine={previewStatusLine}
              sourceType={previewSourceType}
              createdAt={previewCreatedAt}
              preprocessStage={previewStage}
              nextAction={previewNextAction}
              wordCount={previewWordCount}
              sourceUrl={previewSourceUrl}
              keyword={previewKw}
              onKeywordChange={setPreviewKw}
              simplified={previewSimplified}
              onToggleSimplified={setPreviewSimplified}
              highlightHint={previewHighlightHint}
              onClose={() => setPreviewOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
