"use client";

import { useRouter } from "next/navigation";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import InlineConfirmBar from "../ui/InlineConfirmBar";
import SmallPromptModal from "../ui/SmallPromptModal";
import WorkspaceScrimModal from "../ui/WorkspaceScrimModal";
import EmptyState from "../ui/EmptyState";
import UserErrorBanner from "../ui/UserErrorBanner";
import { SkeletonBlock, SkeletonLine } from "../ui/Skeleton";
import { HubMineNotebookCards, HubPopularNotebookGrid } from "./NotesHubCards";
import type { NotebookCoverMeta, NotebookMeta, NotebookSharingRow, PopularNotebookItem } from "./notesNotebookTypes";
import { stableNotebookVisualFromName, type NotebookCardVisual } from "../../lib/notebookCardThemes";
import { isLoggedInAccountUser, useAuth } from "../../lib/auth";
import { apiErrorMessage } from "../../lib/apiError";
import { isAbortError, usePageAbortSignal, usePageFetch } from "../../lib/usePageAbortSignal";
import {
  fetchNotebooksHub,
  NOTEBOOKS_HUB_QUERY_KEY,
  useInvalidateNotebooksHub,
  useNotebooksHubQuery
} from "../../lib/queries/notebooksQueries";
import { useNotebooksMetaQuery } from "../../lib/queries/notebooksMetaQueries";
import { runWhenIdle } from "../../lib/runWhenIdle";
import { readLocalStorageScoped, writeLocalStorageScoped } from "../../lib/userScopedStorage";
import {
  NOTES_DISMISS_OVERLAYS_EVENT,
  NOTES_NAV_HUB_EVENT,
  writeLastNotebookName
} from "../../lib/notesLastNotebook";

type NotesHubDiscoverTab = "mine" | "popular";

const card = "rounded-2xl border border-line bg-surface p-4 shadow-soft";
const WORKBENCH_SECTION_TITLE = "text-base font-semibold tracking-tight text-ink";
const NOTEBOOK_VISUAL_STORAGE_KEY = "notes:notebook-visuals:v1";
const POPULAR_PAGE_SIZE = 18;

function mergeNotebookName(list: string[], name: string): string[] {
  return [...new Set([...list, name])].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function notesHubClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatNotebookShareFailureMessage(raw: string, mode: "share" | "unshare"): string {
  const msg = String(raw || "").trim();
  const prefix = mode === "unshare" ? "取消分享失败" : "分享失败";
  if (!msg) return `${prefix}：服务暂时不可用，请稍后重试。`;
  if (msg.includes("未登录") || msg.includes("401")) {
    return `${prefix}：登录状态已失效，请重新登录后再试。`;
  }
  if (msg.includes("笔记本不存在")) {
    return `${prefix}：该笔记本不存在或已被删除，请刷新列表后重试。`;
  }
  if (msg.includes("笔记本名称不能为空")) {
    return `${prefix}：未识别到笔记本名称，请重新选择笔记本后重试。`;
  }
  if (msg.includes("公开访问需选择") || msg.includes("read_only") || msg.includes("edit")) {
    return `${prefix}：未选择有效分享权限，请选择“只读”或“可创作”后再试。`;
  }
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("upstream_unreachable") ||
    msg.includes("网关") ||
    msg.includes("超时")
  ) {
    return `${prefix}：网络或服务连接异常（可能超时），请稍后重试。`;
  }
  if (msg.includes("保存失败")) {
    return `${prefix}：服务未成功保存设置，请稍后重试。`;
  }
  if (msg.startsWith("分享失败") || msg.startsWith("取消分享失败")) return msg;
  return `${prefix}：${msg}`;
}

function buildNotebookShareUrl(notebookName: string, ownerUserId: string, access: "read_only" | "edit"): string {
  if (typeof window === "undefined") return "";
  const u = new URL(`${window.location.origin}/notes/${encodeURIComponent(notebookName)}`);
  u.searchParams.set("sharedFromOwnerUserId", ownerUserId);
  u.searchParams.set("shareAccess", access);
  return u.toString();
}

function buildSharedNotebookWorkbenchHref(
  notebook: string,
  ownerUserId: string,
  access: "read_only" | "edit"
): string {
  const q = new URLSearchParams({
    sharedFromOwnerUserId: ownerUserId,
    shareAccess: access
  });
  return `/notes/${encodeURIComponent(notebook)}?${q.toString()}`;
}

export default function NotesHubPage() {
  const router = useRouter();
  const { user, getAuthHeaders, ready } = useAuth();
  const isLoggedIn = isLoggedInAccountUser(user);
  const notebooksHubQuery = useNotebooksHubQuery(getAuthHeaders, ready);
  const notebooksHubFetching = notebooksHubQuery.isFetching && Boolean(notebooksHubQuery.data);
  const queryClient = useQueryClient();
  const invalidateNotebooksHub = useInvalidateNotebooksHub();
  const pageAbortSignal = usePageAbortSignal();
  const pageFetch = usePageFetch(pageAbortSignal);

  const [notebooks, setNotebooks] = useState<string[]>([]);
  const [notebooksReady, setNotebooksReady] = useState(false);
  const [notebookVisualByName, setNotebookVisualByName] = useState<Record<string, NotebookCardVisual>>({});
  const [notebookMetaByName, setNotebookMetaByName] = useState<Record<string, NotebookMeta>>({});
  const [notebookSharingByName, setNotebookSharingByName] = useState<Record<string, NotebookSharingRow>>({});
  const [notebookCoversByName, setNotebookCoversByName] = useState<Record<string, NotebookCoverMeta>>({});
  const [hubDiscoverTab, setHubDiscoverTab] = useState<NotesHubDiscoverTab>("mine");
  const [metaQueryEnabled, setMetaQueryEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notebookCardMenu, setNotebookCardMenu] = useState<string | null>(null);

  const [popularItems, setPopularItems] = useState<PopularNotebookItem[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [popularLoadingMore, setPopularLoadingMore] = useState(false);
  const [popularHasMore, setPopularHasMore] = useState(false);
  const popularItemsLenRef = useRef(0);

  const [showNotebookModal, setShowNotebookModal] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [notebookModalError, setNotebookModalError] = useState("");
  const [showRenameNotebook, setShowRenameNotebook] = useState(false);
  const [renameNotebookOld, setRenameNotebookOld] = useState("");
  const [renameNotebookNew, setRenameNotebookNew] = useState("");
  const [deleteNotebookConfirm, setDeleteNotebookConfirm] = useState(false);
  const [deleteNotebookTarget, setDeleteNotebookTarget] = useState<string | null>(null);

  const [showShareNotebookModal, setShowShareNotebookModal] = useState(false);
  const [shareTargetNotebook, setShareTargetNotebook] = useState("");
  const [shareFormAccess, setShareFormAccess] = useState<"read_only" | "edit">("read_only");
  const [shareModalBusy, setShareModalBusy] = useState(false);
  const [shareModalError, setShareModalError] = useState("");
  const [shareCopyHint, setShareCopyHint] = useState("");

  const [showNotebookCoverModal, setShowNotebookCoverModal] = useState(false);
  const [notebookCoverModalTarget, setNotebookCoverModalTarget] = useState("");
  const [notebookCoverModalBusy, setNotebookCoverModalBusy] = useState(false);
  const [notebookCoverModalErr, setNotebookCoverModalErr] = useState("");
  const notebookCoverFileRef = useRef<HTMLInputElement | null>(null);
  const shareLinkRedirectedRef = useRef(false);

  const notebooksMetaQuery = useNotebooksMetaQuery(getAuthHeaders, metaQueryEnabled && hubDiscoverTab === "mine");

  const dismissHubOverlays = useCallback(() => {
    setShowShareNotebookModal(false);
    setShareModalError("");
    setShareCopyHint("");
    setShowNotebookModal(false);
    setShowNotebookCoverModal(false);
    setNotebookModalError("");
    setNewNotebookName("");
    setShowRenameNotebook(false);
    setDeleteNotebookConfirm(false);
    setDeleteNotebookTarget(null);
    setNotebookCardMenu(null);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!isLoggedIn) setHubDiscoverTab("popular");
  }, [ready, isLoggedIn]);

  useEffect(() => {
    if (!ready || typeof window === "undefined" || shareLinkRedirectedRef.current) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const nb = String(sp.get("notebook") || "").trim();
      const owner = String(sp.get("sharedFromOwnerUserId") || "").trim();
      if (!nb || !owner) return;
      shareLinkRedirectedRef.current = true;
      const accRaw = String(sp.get("shareAccess") || "read_only").trim().toLowerCase();
      const acc: "read_only" | "edit" = accRaw === "edit" ? "edit" : "read_only";
      router.replace(buildSharedNotebookWorkbenchHref(nb, owner, acc));
    } catch {
      // ignore
    }
  }, [ready, router]);

  useEffect(() => {
    const onNavHub = () => {
      setError("");
      dismissHubOverlays();
    };
    const onDismissOverlays = () => dismissHubOverlays();
    window.addEventListener(NOTES_NAV_HUB_EVENT, onNavHub);
    window.addEventListener(NOTES_DISMISS_OVERLAYS_EVENT, onDismissOverlays);
    return () => {
      window.removeEventListener(NOTES_NAV_HUB_EVENT, onNavHub);
      window.removeEventListener(NOTES_DISMISS_OVERLAYS_EVENT, onDismissOverlays);
    };
  }, [dismissHubOverlays]);

  useEffect(() => {
    if (!notebooksHubQuery.data) return;
    const data = notebooksHubQuery.data;
    if (Array.isArray(data.notebooks)) setNotebooks(data.notebooks);
    if (data.notebookSharing && typeof data.notebookSharing === "object") {
      setNotebookSharingByName(data.notebookSharing);
    }
    if (data.notebookCovers && typeof data.notebookCovers === "object") {
      setNotebookCoversByName(data.notebookCovers);
    }
    setNotebooksReady(true);
  }, [notebooksHubQuery.data]);

  useEffect(() => {
    if (!notebooksReady) return;
    return runWhenIdle(() => setMetaQueryEnabled(true));
  }, [notebooksReady]);

  useEffect(() => {
    if (!notebooksMetaQuery.data) return;
    setNotebookMetaByName((prev) => {
      const merged: Record<string, NotebookMeta> = {};
      for (const [name, meta] of Object.entries(notebooksMetaQuery.data!)) {
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
  }, [notebooksMetaQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined" || !notebooksReady) return;
    let changed = false;
    let nextMap: Record<string, NotebookCardVisual> = {};
    try {
      const cached = readLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Record<string, NotebookCardVisual>;
        if (parsed && typeof parsed === "object") nextMap = { ...parsed };
      }
    } catch {
      // ignore
    }
    for (const nb of notebooks) {
      if (!nextMap[nb]) {
        nextMap[nb] = stableNotebookVisualFromName(nb);
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
  }, [notebooks, notebooksReady]);

  useEffect(() => {
    popularItemsLenRef.current = popularItems.length;
  }, [popularItems.length]);

  useEffect(() => {
    setNotebookCardMenu(null);
  }, [hubDiscoverTab]);

  const loadNotebooks = useCallback(async () => {
    try {
      const data = await queryClient.fetchQuery({
        queryKey: NOTEBOOKS_HUB_QUERY_KEY,
        queryFn: () => fetchNotebooksHub(getAuthHeaders())
      });
      if (pageAbortSignal.aborted) return;
      if (Array.isArray(data.notebooks)) setNotebooks(data.notebooks);
      if (data.notebookSharing) setNotebookSharingByName(data.notebookSharing);
      if (data.notebookCovers) setNotebookCoversByName(data.notebookCovers);
    } catch (err) {
      if (isAbortError(err)) return;
    } finally {
      if (!pageAbortSignal.aborted) setNotebooksReady(true);
    }
  }, [getAuthHeaders, pageAbortSignal, queryClient]);

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
        const res = await pageFetch(`/api/notebooks/popular?${q.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { ...getAuthHeaders() }
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          items?: PopularNotebookItem[];
          has_more?: boolean;
        };
        if (pageAbortSignal.aborted) return;
        if (res.ok && data.success && Array.isArray(data.items)) {
          setPopularItems((prev) => (append ? [...prev, ...data.items!] : data.items!));
          setPopularHasMore(Boolean(data.has_more));
        } else if (!append) {
          setPopularHasMore(false);
        }
      } catch (err) {
        if (isAbortError(err)) return;
      } finally {
        if (pageAbortSignal.aborted) return;
        if (append) {
          setPopularLoadingMore(false);
        } else {
          setPopularLoading(false);
        }
      }
    },
    [getAuthHeaders, pageAbortSignal, pageFetch]
  );

  useEffect(() => {
    if (hubDiscoverTab !== "popular") return;
    void loadPopularNotebooks(false);
  }, [hubDiscoverTab, loadPopularNotebooks]);

  const onNotesMainPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (notebookCardMenu && !t.closest("[data-notebook-card-overflow-menu]")) {
        setNotebookCardMenu(null);
      }
    },
    [notebookCardMenu]
  );

  useEffect(() => {
    if (!notebookCardMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setNotebookCardMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notebookCardMenu]);

  function openNotebook(name: string) {
    setNotebookCardMenu(null);
    writeLastNotebookName(name);
    setError("");
    router.push(`/notes/${encodeURIComponent(name)}`);
  }

  function openSharedNotebookFromPopular(item: PopularNotebookItem) {
    setNotebookCardMenu(null);
    const access: "read_only" | "edit" = item.publicAccess === "edit" ? "edit" : "read_only";
    setError("");
    router.push(buildSharedNotebookWorkbenchHref(item.notebook, item.ownerUserId, access));
  }

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
      setNewNotebookName("");
      setShowNotebookModal(false);
      setError("");
      setNotebookMetaByName((prev) => ({
        ...prev,
        [name]: {
          noteCount: 0,
          sourceCount: 0,
          createdAt: new Date().toISOString(),
          instanceId: notesHubClientRequestId()
        }
      }));
      setNotebookVisualByName((prev) => {
        if (prev[name]) return prev;
        const next = { ...prev, [name]: stableNotebookVisualFromName(name) };
        try {
          writeLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      setNotebooks((prev) => mergeNotebookName(prev, name));
      invalidateNotebooksHub();
      router.push(`/notes/${encodeURIComponent(name)}`);
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
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ new_name: newN })
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "重命名失败"));
      setShowRenameNotebook(false);
      setNotebookMetaByName((prev) => {
        const carry = prev[oldN];
        const next = { ...prev };
        delete next[oldN];
        if (carry) next[newN] = { ...carry, ...(next[newN] || {}) };
        return next;
      });
      setNotebookVisualByName((prev) => {
        const carried = prev[oldN];
        if (!carried) return prev;
        const next = { ...prev };
        delete next[oldN];
        next[newN] = carried;
        try {
          writeLocalStorageScoped(NOTEBOOK_VISUAL_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      await loadNotebooks();
      invalidateNotebooksHub();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteNotebook() {
    const target = deleteNotebookTarget || "";
    setDeleteNotebookConfirm(false);
    setDeleteNotebookTarget(null);
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(target)}/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: "{}"
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "删除失败"));
      setNotebookMetaByName((prev) => {
        const { [target]: _, ...rest } = prev;
        return rest;
      });
      await loadNotebooks();
      invalidateNotebooksHub();
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
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body)
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; detail?: unknown };
      if (!res.ok || !data.success) throw new Error(apiErrorMessage(data, "保存失败"));
      setShowNotebookCoverModal(false);
      setNotebookCoverModalTarget("");
      await loadNotebooks();
      invalidateNotebooksHub();
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
      invalidateNotebooksHub();
    } catch (err) {
      setNotebookCoverModalErr(String(err instanceof Error ? err.message : err));
    } finally {
      setNotebookCoverModalBusy(false);
    }
  }

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
  }, [notebookSharingByName, shareFormAccess, shareTargetNotebook, user?.user_id]);

  async function submitNotebookSharing() {
    const name = shareTargetNotebook.trim();
    if (!name) return;
    setShareModalBusy(true);
    setShareModalError("");
    try {
      const clientRequestId = notesHubClientRequestId();
      const payload = {
        isPublic: true,
        publicAccess: shareFormAccess,
        listedInDiscover: true
      };
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}/share`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-request-id": clientRequestId, ...getAuthHeaders() },
        body: JSON.stringify(payload)
      });
      const raw = await res.text();
      let data: { success?: boolean; detail?: unknown } = {};
      try {
        data = (JSON.parse(raw || "{}") || {}) as { detail?: unknown };
      } catch {
        data = {};
      }
      if (!res.ok || data.success === false) throw new Error(apiErrorMessage(data, "保存失败"));
      await loadNotebooks();
      invalidateNotebooksHub();
      if (hubDiscoverTab === "popular") void loadPopularNotebooks(false);
      setShowShareNotebookModal(false);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setShareModalError(formatNotebookShareFailureMessage(msg, "share"));
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
      const clientRequestId = notesHubClientRequestId();
      const res = await fetch(`/api/notebooks/${encodeURIComponent(name)}/share`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-request-id": clientRequestId, ...getAuthHeaders() },
        body: JSON.stringify({ isPublic: false, publicAccess: "read_only", listedInDiscover: false })
      });
      const raw = await res.text();
      let data: { success?: boolean; detail?: unknown } = {};
      try {
        data = (JSON.parse(raw || "{}") || {}) as { detail?: unknown };
      } catch {
        data = {};
      }
      if (!res.ok || data.success === false) throw new Error(apiErrorMessage(data, "保存失败"));
      await loadNotebooks();
      invalidateNotebooksHub();
      setShowShareNotebookModal(false);
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      setShareModalError(formatNotebookShareFailureMessage(msg, "unshare"));
    } finally {
      setShareModalBusy(false);
    }
  }

  return (
    <main
      className="mx-auto min-h-0 w-full max-w-[min(100%,1800px)] px-3 pb-10 sm:px-4"
      onPointerDown={onNotesMainPointerDown}
    >
      {error ? (
        <UserErrorBanner className="mb-4" message={error} onDismiss={() => setError("")} />
      ) : null}

      <div
        className="mb-4 flex gap-1 rounded-xl border border-line/60 bg-fill/35 p-1"
        role="tablist"
        aria-label="笔记本发现"
      >
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
          发现
        </button>
      </div>

      <section className={card}>
        {hubDiscoverTab === "mine" ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className={WORKBENCH_SECTION_TITLE}>
                  我的笔记本
                  {notebooksHubFetching ? (
                    <span className="ml-2 text-xs font-normal text-muted">更新中…</span>
                  ) : null}
                </h2>
              </div>
              {notebooksReady && notebooks.length === 0 ? (
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
            {!notebooksReady ? (
              <div className="mt-4 space-y-3" aria-busy aria-label="加载笔记本列表">
                <SkeletonLine className="h-4 w-full max-w-md" />
                <div className="flex gap-3 overflow-x-auto pb-2">
                  <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
                  <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
                  <SkeletonBlock className="h-36 w-44 shrink-0 rounded-2xl" />
                </div>
              </div>
            ) : notebooks.length === 0 ? (
              <EmptyState
                title="还没有笔记本"
                description="新建后添加资料，即可在右侧提问或生成。"
                className="mt-4 border-dashed border-line bg-fill/40 py-8"
              />
            ) : (
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
            )}
          </>
        ) : (
          <>
            <h2 className={WORKBENCH_SECTION_TITLE}>发现</h2>
            <div className="mt-3 min-h-0 max-h-[min(85dvh,720px)] min-w-0 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
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
        )}
      </section>

      <WorkspaceScrimModal
        open={Boolean(showNotebookCoverModal && notebookCoverModalTarget.trim())}
        onClose={() => {
          setShowNotebookCoverModal(false);
          setNotebookCoverModalErr("");
        }}
        labelledBy="hub-notebook-cover-title"
        scrimTone="45"
        busy={notebookCoverModalBusy}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-modal"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h2 id="hub-notebook-cover-title" className="text-base font-semibold text-ink">
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
      </WorkspaceScrimModal>

      <WorkspaceScrimModal
        open={showShareNotebookModal}
        onClose={() => {
          setShowShareNotebookModal(false);
          setShareCopyHint("");
        }}
        labelledBy="hub-share-notebook-title"
        scrimTone="45"
        busy={shareModalBusy}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-modal"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h2 id="hub-share-notebook-title" className="text-base font-semibold text-ink">
            分享
          </h2>
          <p className="mt-1 truncate text-xs text-muted" title={shareTargetNotebook}>
            笔记本：{shareTargetNotebook || "—"}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            选择分享方式后点击「分享」生效。未登录访客可打开链接查看资料与参考资料内容；基于参考资料的创作需访客登录。已开启分享后可复制链接。
          </p>
          <fieldset className="mt-4 space-y-3 rounded-xl border border-line/80 p-3">
            <legend className="px-1 text-xs font-semibold text-ink">分享方式</legend>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-fill/50">
              <input
                type="radio"
                name="hub-notebook-share-access"
                className="mt-0.5 accent-brand"
                checked={shareFormAccess === "read_only"}
                onChange={() => setShareFormAccess("read_only")}
                disabled={shareModalBusy}
              />
              <span>
                <span className="text-sm font-medium text-ink">只读</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                  访客可查看参考资料及其内容、向资料提问；不可添加或修改笔记，不可基于参考资料生成播客或长文。
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg p-2 hover:bg-fill/50">
              <input
                type="radio"
                name="hub-notebook-share-access"
                className="mt-0.5 accent-brand"
                checked={shareFormAccess === "edit"}
                onChange={() => setShareFormAccess("edit")}
                disabled={shareModalBusy}
              />
              <span>
                <span className="text-sm font-medium text-ink">可创作</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                  在只读能力基础上，允许登录访客使用所选参考资料生成播客或文章（写入访客自己的作品，不改变你的笔记）。
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
                notebookSharingByName[shareTargetNotebook]?.isPublic ? undefined : "请先分享后再复制链接"
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
          {shareModalError ? (
            <p className="mt-3 text-xs text-danger-ink" role="alert">
              {shareModalError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-line bg-fill/40 px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
              disabled={shareModalBusy}
              onClick={() => {
                if (!shareModalBusy) {
                  setShowShareNotebookModal(false);
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
      </WorkspaceScrimModal>

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
          message={`确认删除笔记本「${deleteNotebookTarget || ""}」？其下笔记将永久删除（不可从笔记回收站恢复）；由该笔记本资料生成的播客与文章将移入作品回收站。`}
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
    </main>
  );
}
