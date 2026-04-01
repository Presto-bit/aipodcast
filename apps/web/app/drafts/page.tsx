"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TTS_IMPORT_SCRIPT_KEY } from "../../lib/ttsImport";

const DRAFTS_STORAGE_KEY = "fym_podcast_drafts_v1";

type Draft = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

function loadDrafts(): Draft[] {
  try {
    const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveDrafts(list: Draft[]) {
  try {
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify((list || []).slice(0, 100)));
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

const card =
  "rounded-2xl border border-line bg-white shadow-sm";

const storageHint =
  "草稿仅保存在本机浏览器：不会上传账号、也不会跨设备同步。清理站点数据或更换浏览器后可能丢失，重要内容请自行备份。";

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const lastLoadedIdRef = useRef<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const list = loadDrafts();
    setDrafts(list);
    setActiveId(list[0]?.id ? String(list[0].id) : null);
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
    saveDrafts(next);
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
    saveDrafts(next);
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
    saveDrafts(next);
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
      sessionStorage.setItem(TTS_IMPORT_SCRIPT_KEY, text);
    } catch {
      // ignore
    }
    window.location.href = "/tts";
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-6xl px-3 pb-10 sm:px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">播客草稿箱</h1>
        <p className="mt-2 text-sm text-muted">
          多份文稿本地管理，布局接近 AI 播客编辑区；写好片段可一键送到「文本转语音」继续合成。
        </p>
        <p className="mt-1 text-xs text-muted">{storageHint}</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand"
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
              <li className="text-muted">暂无草稿，点击上方「新建草稿」开始</li>
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
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                  onClick={() => deleteDraftById(activeDraft.id)}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
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
              {dirty ? <p className="mt-2 text-xs text-amber-700">未保存的修改将在约 0.8 秒后自动写入本机</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">请在左侧选择草稿，或点击「新建草稿」</p>
          )}
        </div>
      </div>
    </main>
  );
}
