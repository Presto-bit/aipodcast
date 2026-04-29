"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFTS_NAV_FOCUS_DRAFT_ID_KEY,
  loadPodcastDrafts,
  savePodcastDrafts,
  type PodcastDraft
} from "../../lib/podcastDrafts";
import { TTS_IMPORT_SCRIPT_KEY } from "../../lib/ttsImport";
import {
  readSessionStorageScoped,
  removeSessionStorageScoped,
  writeSessionStorageScoped
} from "../../lib/userScopedStorage";

type Draft = PodcastDraft;

function nowIso() {
  return new Date().toISOString();
}

const card =
  "rounded-2xl border border-line bg-surface shadow-soft";

const storageHint = "仅保存在本机浏览器，清数据或换设备会丢失。";

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const lastLoadedIdRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const list = loadPodcastDrafts();
    setDrafts(list);
    let nextActive = list[0]?.id ? String(list[0].id) : null;
    const focusRaw = readSessionStorageScoped(DRAFTS_NAV_FOCUS_DRAFT_ID_KEY);
    if (focusRaw) {
      removeSessionStorageScoped(DRAFTS_NAV_FOCUS_DRAFT_ID_KEY);
      const fid = String(focusRaw || "").trim();
      if (fid && list.some((d) => String(d.id) === fid)) nextActive = fid;
    }
    setActiveId(nextActive);
  }, []);

  const sortedDrafts = useMemo(() => {
    const arr = drafts.slice();
    arr.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return arr;
  }, [drafts]);

  const activeDraft = useMemo(() => {
    if (!activeId) return null;
    return sortedDrafts.find((d) => String(d.id) === String(activeId)) || null;
  }, [sortedDrafts, activeId]);

  useEffect(() => {
    if (!activeDraft) {
      if (sortedDrafts[0]?.id) setActiveId(String(sortedDrafts[0].id));
      return;
    }
    const sid = String(activeDraft.id);
    if (lastLoadedIdRef.current === sid) return;
    lastLoadedIdRef.current = sid;
    setTitleInput(String(activeDraft.title || "").trim() || "未命名草稿");
    setTextInput(String(activeDraft.text || ""));
    setDirty(false);
  }, [activeDraft, sortedDrafts]);

  const saveActive = useCallback(() => {
    if (!activeDraft) return;
    const sid = String(activeDraft.id);
    const title = String(titleInput || "").trim() || "未命名草稿";
    const text = String(textInput || "");
    const t = nowIso();
    const next = sortedDrafts.map((d) => (String(d.id) === sid ? { ...d, title, text, updatedAt: t } : d));
    setDrafts(next);
    savePodcastDrafts(next);
    setDirty(false);
  }, [activeDraft, sortedDrafts, titleInput, textInput]);

  useEffect(() => {
    if (!activeDraft) return undefined;
    if (!dirty) return undefined;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      saveActive();
    }, 800);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [activeDraft, dirty, titleInput, textInput, saveActive]);

  function createDraft() {
    const id = `${Date.now()}`;
    const t = nowIso();
    const entry: Draft = { id, title: "未命名草稿", text: "", createdAt: t, updatedAt: t };
    const next = [entry, ...sortedDrafts].slice(0, 100);
    setDrafts(next);
    savePodcastDrafts(next);
    setActiveId(id);
  }

  function deleteDraftById(id: string) {
    const sid = String(id || "").trim();
    if (!sid) return;
    const target = sortedDrafts.find((d) => String(d.id) === sid);
    const label = String(target?.title || "").trim() || "该草稿";
    if (!window.confirm(`确定删除「${label}」吗？`)) return;
    const next = sortedDrafts.filter((d) => String(d.id) !== sid);
    setDrafts(next);
    savePodcastDrafts(next);
    if (String(activeId) === sid) {
      lastLoadedIdRef.current = null;
      setActiveId(next[0]?.id ? String(next[0].id) : null);
    }
  }

  function importToTts() {
    const text = String(textInput || "").trim();
    if (!text) {
      window.alert("草稿内容为空");
      return;
    }
    try {
      writeSessionStorageScoped(TTS_IMPORT_SCRIPT_KEY, text);
    } catch {
      // ignore
    }
    window.location.href = "/tts";
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">播客草稿箱</h1>
        <p className="mt-2 text-sm text-muted">本地文稿；可送到「文本转语音」。</p>
        <p className="mt-1 text-xs text-muted">{storageHint}</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground shadow-soft hover:bg-brand"
          onClick={createDraft}
        >
          新建草稿
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className={`${card} p-3`}>
          <p className="text-xs font-medium text-muted">本地草稿列表</p>
          <ul className="mt-2 max-h-[min(60vh,520px)] space-y-1 overflow-auto text-sm">
            {sortedDrafts.length === 0 ? (
              <li className="rounded-lg border border-dashed border-line bg-fill/40 p-3 text-xs leading-relaxed text-muted">
                <p className="font-medium text-ink">还没有本地草稿</p>
                <p className="mt-1">点下方「新建草稿」写一版，或从</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href="/create" className="text-brand hover:underline">
                    开始创作
                  </Link>
                  <span className="text-muted">·</span>
                  <Link href="/notes" className="text-brand hover:underline">
                    笔记本
                  </Link>
                </p>
                <p className="mt-1 text-muted">写好后可用右侧「送到文本转语音」。</p>
              </li>
            ) : null}
            {sortedDrafts.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                    String(activeId) === String(d.id)
                      ? "bg-fill text-brand"
                      : "text-ink hover:bg-fill"
                  }`}
                  onClick={() => setActiveId(String(d.id))}
                >
                  <span className="line-clamp-2">{d.title || "未命名"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${card} p-4 sm:p-5`}>
          {activeDraft ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="min-w-[200px] flex-1 rounded-lg border border-line bg-fill p-2 text-sm text-ink"
                  value={titleInput}
                  onChange={(e) => {
                    setTitleInput(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="标题"
                />
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-fill"
                  onClick={() => saveActive()}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs text-danger-ink hover:bg-danger-soft"
                  onClick={() => deleteDraftById(activeDraft.id)}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-mint px-3 py-1.5 text-xs text-mint-foreground hover:bg-mint/90"
                  onClick={importToTts}
                >
                  送到文本转语音
                </button>
              </div>
              <textarea
                className="mt-4 w-full min-h-[min(50vh,420px)] rounded-xl border border-line bg-fill p-4 text-sm leading-relaxed text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                value={textInput}
                onChange={(e) => {
                  setTextInput(e.target.value);
                  setDirty(true);
                }}
                placeholder="可写大纲、口播要点或整段口播稿…"
              />
              {dirty ? <p className="mt-2 text-xs text-warning-ink">将自动保存到本机</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">请选择或新建草稿</p>
          )}
        </div>
      </div>
    </main>
  );
}
