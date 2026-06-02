"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeComposerFormatCard from "./HomeComposerFormatCard";
import {
  activeHomeComposerSession,
  appendHomeComposerTurn,
  createHomeComposerSession,
  loadHomeComposerStore,
  patchActiveHomeComposerSession,
  saveHomeComposerStore,
  selectHomeComposerSession,
  updateHomeComposerTurn
} from "../../lib/homeComposerChatStorage";
import type { HomeComposerStore } from "../../lib/homeComposerTypes";
import { homeComposerTurnsToMemoryTurns, streamHomeComposerAsk } from "../../lib/homeComposerAskStream";
import { runHomeComposerFormatJobs } from "../../lib/homeComposerFormatJobs";
import {
  EMPTY_HOME_COMPOSER_PERSONAL,
  HOME_COMPOSER_FORMATS,
  HOME_COMPOSER_FORMAT_LABELS,
  type HomeComposerFormat,
  type HomeComposerFormatResult,
  type HomeComposerPersonalProfile,
  type HomeComposerTurn
} from "../../lib/homeComposerTypes";
import {
  fetchDefaultAuthorIp,
  personalProfileFromAuthorIp,
  personalProfileToPrompt,
  saveDefaultAuthorIpProfile
} from "../../lib/homeComposerProfile";
import { fetchAuthorIpByNotebook } from "../../lib/authorIp";
import { isUserPersonaStyleTemplateCategory } from "../../lib/creativeTemplates";
import { listUserTemplates } from "../../lib/userTemplates";
import { useNotebooksHubQuery } from "../../lib/queries/notebooksQueries";

const NotesAskAnswerMarkdownBody = dynamic(
  () => import("../notes/NotesAskAnswerMarkdownBody").then((m) => ({ default: m.default })),
  { loading: () => <p className="text-sm text-muted">加载回答…</p> }
);

type NoteRow = { noteId: string; title?: string };

const PERSONAL_FIELDS: { key: keyof HomeComposerPersonalProfile; label: string; rows: number }[] = [
  { key: "identity", label: "1. 我的身份/职业", rows: 2 },
  { key: "currentDoing", label: "2. 我目前在做什么", rows: 2 },
  { key: "pastExperience", label: "3. 我过去的重要经历", rows: 2 },
  { key: "difficulties", label: "4. 我经历过的关键困难/低谷/失败", rows: 2 },
  { key: "choices", label: "5. 我做过的重要选择", rows: 2 },
  { key: "results", label: "6. 我拿到过的结果/成绩/反馈", rows: 2 },
  { key: "remember", label: "7. 我最想让别人记住我的点", rows: 2 },
  { key: "values", label: "8. 我想传递的价值观", rows: 2 },
  { key: "other", label: "9. 其他", rows: 2 }
];

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [active, onOutside, ref]);
}

type MenuKey = "format" | "kb" | "style" | "";

export default function HomeComposerPage({
  getAuthHeaders,
  isLoggedIn,
  ready,
  createdByPhone
}: {
  getAuthHeaders: () => Record<string, string>;
  isLoggedIn: boolean;
  ready: boolean;
  createdByPhone?: string;
}) {
  const [store, setStore] = useState<HomeComposerStore | null>(null);
  const [input, setInput] = useState("");
  const [openMenu, setOpenMenu] = useState<MenuKey | "">("");
  const [personalOpen, setPersonalOpen] = useState(false);
  const [personalDraft, setPersonalDraft] = useState<HomeComposerPersonalProfile>(EMPTY_HOME_COMPOSER_PERSONAL);
  const [defaultIpId, setDefaultIpId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyToast, setCopyToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const askAbortRef = useRef<AbortController | null>(null);
  const formatRootRef = useRef<HTMLDivElement>(null);
  const kbRootRef = useRef<HTMLDivElement>(null);
  const styleRootRef = useRef<HTMLDivElement>(null);

  useClickOutside(formatRootRef, () => setOpenMenu((m) => (m === "format" ? "" : m)), openMenu === "format");
  useClickOutside(kbRootRef, () => setOpenMenu((m) => (m === "kb" ? "" : m)), openMenu === "kb");
  useClickOutside(styleRootRef, () => setOpenMenu((m) => (m === "style" ? "" : m)), openMenu === "style");

  const notebooksQuery = useNotebooksHubQuery(getAuthHeaders, isLoggedIn && ready, undefined);
  const notebooks = notebooksQuery.data?.notebooks ?? [];

  const session = useMemo(() => (store ? activeHomeComposerSession(store) : null), [store]);
  const prefs = session?.prefs;
  const hasSent = (session?.turns.length ?? 0) > 0;
  const kbOn = Boolean(prefs?.notebook?.trim());
  const styleTemplates = useMemo(
    () => listUserTemplates().filter((t) => isUserPersonaStyleTemplateCategory(t.category)),
    [store?.activeSessionId]
  );
  const selectedStyle = styleTemplates.find((t) => t.id === prefs?.styleTemplateId) ?? null;
  const [notebookStylePrompt, setNotebookStylePrompt] = useState("");

  useEffect(() => {
    setStore(loadHomeComposerStore());
  }, []);

  useEffect(() => {
    if (!store) return;
    saveHomeComposerStore(store);
  }, [store]);

  useEffect(() => {
    if (!isLoggedIn) return;
    void fetchDefaultAuthorIp()
      .then((item) => {
        if (!item?.id) return;
        setDefaultIpId(item.id);
        const profile = personalProfileFromAuthorIp(item);
        if (!profile || !store) return;
        setStore((prev: HomeComposerStore | null) => {
          if (!prev) return prev;
          const active = activeHomeComposerSession(prev);
          if (!active || active.prefs.personalProfile) return prev;
          return patchActiveHomeComposerSession(prev, {
            prefs: { ...active.prefs, personalProfile: profile }
          });
        });
      })
      .catch(() => {
        // 非阻塞
      });
  }, [isLoggedIn, store?.activeSessionId]);

  useEffect(() => {
    const nb = prefs?.notebook?.trim();
    if (!nb || !isLoggedIn) {
      setNotes([]);
      return;
    }
    setNotesLoading(true);
    const q = new URLSearchParams({ notebook: nb, limit: "120" });
    void fetch(`/api/notes?${q}`, { credentials: "same-origin", headers: getAuthHeaders() })
      .then((res) => res.json())
      .then((data: { notes?: NoteRow[] }) => setNotes(Array.isArray(data.notes) ? data.notes : []))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  }, [prefs?.notebook, isLoggedIn, getAuthHeaders]);

  useEffect(() => {
    const nb = prefs?.notebook?.trim();
    if (!nb || !isLoggedIn) {
      setNotebookStylePrompt("");
      return;
    }
    void fetchAuthorIpByNotebook(nb)
      .then((item) => {
        const p = item?.profile;
        const text =
          p && typeof p === "object" && typeof (p as Record<string, unknown>).stylePrompt === "string"
            ? String((p as Record<string, unknown>).stylePrompt)
            : item?.oneLiner || "";
        setNotebookStylePrompt(text.trim());
      })
      .catch(() => setNotebookStylePrompt(""));
  }, [prefs?.notebook, isLoggedIn]);

  const persistPrefs = useCallback((patch: Partial<NonNullable<typeof prefs>>) => {
    setStore((prev: HomeComposerStore | null) => {
      if (!prev) return prev;
      return patchActiveHomeComposerSession(prev, (s) => ({
        ...s,
        prefs: { ...s.prefs, ...patch }
      }));
    });
  }, []);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    window.setTimeout(() => setCopyToast(""), 2600);
  }, []);

  const resolveStylePrompt = useCallback(() => {
    if (kbOn) return notebookStylePrompt;
    return selectedStyle?.textPrefix?.trim() || "";
  }, [kbOn, notebookStylePrompt, selectedStyle]);

  const resolveAuthorPrompt = useCallback(() => {
    if (!prefs?.personalEnabled || !prefs.personalProfile) return "";
    return personalProfileToPrompt(prefs.personalProfile);
  }, [prefs?.personalEnabled, prefs?.personalProfile]);

  const runTurn = useCallback(
    async (userText: string, opts?: { replaceLast?: boolean }) => {
      if (!store || !session) return;
      if (!isLoggedIn) {
        setError("请先登录后再发送");
        return;
      }
      const q = userText.trim();
      if (!q) return;

      setError("");
      setBusy(true);
      askAbortRef.current?.abort();
      const abort = new AbortController();
      askAbortRef.current = abort;

      const turnId = crypto.randomUUID();
      const initialFormats: Partial<Record<HomeComposerFormat, HomeComposerFormatResult>> = {};
      for (const f of prefs?.formats ?? []) {
        initialFormats[f] = { status: "pending" };
      }

      const turn: HomeComposerTurn = {
        id: turnId,
        userText: q,
        general: { content: "", streaming: true, streamingPhase: "正在连接…" },
        formats: initialFormats,
        createdAt: Date.now()
      };

      let nextStore = appendHomeComposerTurn(store, turn, { replaceLast: opts?.replaceLast });
      setStore(nextStore);
      setInput("");

      const memoryTurns = homeComposerTurnsToMemoryTurns(
        nextStore.sessions.find((s) => s.id === nextStore.activeSessionId)?.turns.slice(0, -1) ?? []
      );

      const useRag = Boolean(prefs?.notebook?.trim() && (prefs?.noteIds?.length ?? 0) > 0);
      let sessionState = session.sessionState;

      try {
        const askDone = await streamHomeComposerAsk({
          question: q,
          mode: useRag ? "rag" : "general",
          notebook: prefs?.notebook,
          noteIds: prefs?.noteIds,
          memoryTurns,
          sessionState,
          globalStylePrompt: !useRag ? resolveStylePrompt() : undefined,
          authorIpPrompt: !useRag ? resolveAuthorPrompt() : undefined,
          dialogueStylePrompt: useRag ? resolveStylePrompt() || undefined : undefined,
          authHeaders: getAuthHeaders(),
          signal: abort.signal,
          callbacks: {
            onPhase: (msg) => {
              setStore((prev) =>
                prev
                  ? updateHomeComposerTurn(prev, turnId, (t) => ({
                      ...t,
                      general: { ...t.general!, streaming: true, streamingPhase: msg, content: t.general?.content || "" }
                    }))
                  : prev
              );
            },
            onChunk: (text, role, section) => {
              if (role !== "answer") return;
              setStore((prev) =>
                prev
                  ? updateHomeComposerTurn(prev, turnId, (t) => {
                      const g = t.general || { content: "" };
                      const content =
                        section === "supplement"
                          ? g.content
                          : (g.content || "") + text;
                      const supplementContent =
                        section === "supplement"
                          ? (g.supplementContent || "") + text
                          : g.supplementContent;
                      return {
                        ...t,
                        general: {
                          ...g,
                          content,
                          supplementContent,
                          streaming: true
                        }
                      };
                    })
                  : prev
              );
            }
          }
        });

        sessionState = askDone.sessionState;
        nextStore = updateHomeComposerTurn(nextStore, turnId, (t) => ({
          ...t,
          general: {
            content: askDone.answer,
            supplementContent: askDone.supplementAnswer,
            streaming: false,
            streamingPhase: undefined
          }
        }));
        nextStore = patchActiveHomeComposerSession(nextStore, { sessionState });
        setStore(nextStore);

        const formats = prefs?.formats ?? [];
        if (formats.length) {
          nextStore = updateHomeComposerTurn(nextStore, turnId, (t) => {
            const fm = { ...t.formats };
            for (const f of formats) fm[f] = { status: "running", progress: "准备中…" };
            return { ...t, formats: fm };
          });
          setStore(nextStore);

          const noteTitleById = Object.fromEntries(notes.map((n) => [n.noteId, n.title || ""]));
          const results = await runHomeComposerFormatJobs(
            formats,
            {
              userPrompt: q,
              generalAnswer: askDone.answer,
              notebook: prefs?.notebook || "",
              noteIds: prefs?.noteIds || [],
              noteTitles: (prefs?.noteIds || []).map((id) => String(noteTitleById[id] || "")),
              stylePrompt: resolveStylePrompt(),
              authorIpPrompt: resolveAuthorPrompt(),
              authHeaders: getAuthHeaders(),
              createdBy: createdByPhone
            },
            (format, msg) => {
              setStore((prev) =>
                prev
                  ? updateHomeComposerTurn(prev, turnId, (t) => ({
                      ...t,
                      formats: {
                        ...t.formats,
                        [format]: { status: "running", progress: msg }
                      }
                    }))
                  : prev
              );
            }
          );

          nextStore = updateHomeComposerTurn(nextStore, turnId, (t) => {
            const fm = { ...t.formats };
            for (const r of results) {
              if (r.status === "done") {
                fm[r.format] = {
                  status: "done",
                  jobId: r.jobId,
                  social: r.social,
                  scriptText: r.scriptText
                };
              } else {
                fm[r.format] = { status: "error", error: r.error, jobId: r.jobId };
              }
            }
            return { ...t, formats: fm };
          });
          setStore(nextStore);
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = String(err instanceof Error ? err.message : err);
        setError(msg);
        setStore((prev) =>
          prev
            ? updateHomeComposerTurn(prev, turnId, (t) => ({
                ...t,
                general: {
                  content: t.general?.content || "",
                  streaming: false,
                  streamingPhase: undefined
                }
              }))
            : prev
        );
      } finally {
        setBusy(false);
        if (askAbortRef.current === abort) askAbortRef.current = null;
      }
    },
    [
      store,
      session,
      isLoggedIn,
      prefs,
      notes,
      getAuthHeaders,
      createdByPhone,
      resolveStylePrompt,
      resolveAuthorPrompt
    ]
  );

  function handleSend() {
    void runTurn(input);
  }

  function handleRegenLast() {
    const last = session?.turns[session.turns.length - 1];
    if (!last?.userText.trim()) return;
    void runTurn(last.userText, { replaceLast: true });
  }

  function toggleFormat(id: HomeComposerFormat) {
    const cur = prefs?.formats ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    persistPrefs({ formats: next });
  }

  function selectNotebook(name: string) {
    if (prefs?.notebook === name) {
      persistPrefs({ notebook: "", noteIds: [] });
      return;
    }
    persistPrefs({ notebook: name, noteIds: [] });
    setOpenMenu("");
  }

  function toggleNote(noteId: string) {
    const cur = prefs?.noteIds ?? [];
    const next = cur.includes(noteId) ? cur.filter((x) => x !== noteId) : [...cur, noteId];
    persistPrefs({ noteIds: next });
  }

  function savePersonal() {
    persistPrefs({
      personalProfile: { ...personalDraft },
      personalEnabled: true
    });
    setPersonalOpen(false);
    if (defaultIpId) {
      void saveDefaultAuthorIpProfile(defaultIpId, personalDraft).catch(() => {
        // 本地已保存，云端失败不阻塞
      });
    }
  }

  const statusItems: string[] = [];
  if (prefs?.formats?.length) {
    statusItems.push(`格式：${prefs.formats.map((f) => HOME_COMPOSER_FORMAT_LABELS[f]).join("、")}`);
  }
  if (kbOn) {
    statusItems.push(`资料：${prefs!.notebook}${prefs!.noteIds?.length ? `（${prefs!.noteIds.length} 条）` : ""}`);
  }
  if (!kbOn && selectedStyle) statusItems.push(`风格：${selectedStyle.label}`);
  if (kbOn && notebookStylePrompt.trim()) statusItems.push("风格：笔记本");
  if (prefs?.personalEnabled && prefs.personalProfile) statusItems.push("个人特色");

  if (!store || !session) {
    return (
      <main className="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-4">
        <p className="text-sm text-muted">加载创作台…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-col px-3 pb-8 pt-2 sm:px-4">
      {copyToast ? (
        <div className="fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-canvas shadow-lg">
          {copyToast}
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-fill"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          对话
        </button>
        <button
          type="button"
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-fill"
          onClick={() => setStore(createHomeComposerSession(store, session.prefs))}
        >
          新对话
        </button>
      </div>

      {sidebarOpen ? (
        <div className="mb-4 rounded-xl border border-line bg-surface p-3">
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {store.sessions.map((s: (typeof store.sessions)[number]) => (
              <button
                key={s.id}
                type="button"
                className={[
                  "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                  s.id === store.activeSessionId ? "bg-brand/10 font-medium text-ink" : "text-muted hover:bg-fill"
                ].join(" ")}
                onClick={() => {
                  setStore(selectHomeComposerSession(store, s.id));
                  setSidebarOpen(false);
                }}
              >
                {s.title || "新对话"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!hasSent ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">聊想法，复制就能发</h1>
          <p className="mt-2 max-w-md text-sm text-muted">输入想法，选格式，通识对话与成品卡一次到位。</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4">
          {session.turns.map((turn) => (
            <div key={turn.id} className="space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl bg-brand/10 px-4 py-2.5 text-sm text-ink">
                  {turn.userText}
                </div>
              </div>

              {turn.general ? (
                <div className="rounded-xl border border-line/80 bg-surface px-4 py-3">
                  {turn.general.streaming ? (
                    <p className="text-sm text-muted">{turn.general.streamingPhase || "生成中…"}</p>
                  ) : null}
                  {turn.general.content ? (
                    <div className="text-sm leading-relaxed">
                      <NotesAskAnswerMarkdownBody text={turn.general.content} />
                    </div>
                  ) : null}
                  {turn.general.supplementContent ? (
                    <div className="mt-3 border-t border-line/60 pt-3 text-sm leading-relaxed text-muted">
                      <NotesAskAnswerMarkdownBody text={turn.general.supplementContent} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {(prefs?.formats ?? []).map((format) => {
                const result = turn.formats[format];
                if (!result) return null;
                return (
                  <HomeComposerFormatCard
                    key={`${turn.id}-${format}`}
                    format={format}
                    result={result}
                    onCopyToast={showCopyToast}
                  />
                );
              })}
            </div>
          ))}
          {hasSent ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-fill disabled:opacity-50"
                onClick={handleRegenLast}
              >
                重新生成最后一轮
              </button>
            </div>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mb-2 text-sm text-danger-ink" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={[
          "sticky bottom-2 z-20 rounded-2xl border border-line bg-surface p-3 shadow-soft",
          openMenu ? "z-30" : ""
        ].join(" ")}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="消息…"
          rows={2}
          className="w-full resize-none rounded-xl border border-line/70 bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-brand/40 focus:ring-1 focus:ring-brand/20"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && input.trim()) handleSend();
            }
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div ref={formatRootRef} className="relative">
            <button
              type="button"
              className="rounded-lg border border-line bg-fill/40 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-fill"
              onClick={() => setOpenMenu(openMenu === "format" ? "" : "format")}
            >
              格式{(prefs?.formats?.length ?? 0) ? ` · ${prefs!.formats.length}` : ""}
            </button>
            {openMenu === "format" ? (
              <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[132px] rounded-xl border border-line bg-surface p-2 shadow-card">
                {HOME_COMPOSER_FORMATS.map((f) => (
                  <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-fill">
                    <input
                      type="checkbox"
                      checked={prefs?.formats.includes(f.id) ?? false}
                      onChange={() => toggleFormat(f.id)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <div ref={kbRootRef} className="relative ml-auto">
            <button
              type="button"
              className="rounded-lg border border-line bg-fill/40 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-fill"
              onClick={() => setOpenMenu(openMenu === "kb" ? "" : "kb")}
            >
              资料{kbOn ? ` · ${prefs?.notebook}` : ""}
            </button>
            {openMenu === "kb" ? (
              <div className="absolute bottom-full right-0 z-50 mb-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-card">
                {notebooks.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted">
                    还没有笔记本，{" "}
                    <Link href="/notes" className="text-brand underline">
                      去知识库
                    </Link>
                  </p>
                ) : (
                  notebooks.map((nb) => (
                    <div key={nb} className="mb-2">
                      <button
                        type="button"
                        className={[
                          "w-full rounded-lg px-2 py-1.5 text-left text-sm",
                          prefs?.notebook === nb ? "bg-brand/10 font-medium" : "hover:bg-fill"
                        ].join(" ")}
                        onClick={() => selectNotebook(nb)}
                      >
                        {nb}
                      </button>
                      {prefs?.notebook === nb ? (
                        <div className="mt-1 space-y-1 pl-2">
                          {notesLoading ? (
                            <p className="text-xs text-muted">加载资料…</p>
                          ) : notes.length ? (
                            notes.map((n) => (
                              <label
                                key={n.noteId}
                                className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-fill"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={prefs?.noteIds.includes(n.noteId) ?? false}
                                  onChange={() => toggleNote(n.noteId)}
                                />
                                <span>{n.title || n.noteId.slice(0, 8)}</span>
                              </label>
                            ))
                          ) : (
                            <p className="text-xs text-muted">该笔记本暂无资料</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {!kbOn ? (
            <div ref={styleRootRef} className="relative">
              <button
                type="button"
                className="rounded-lg border border-line bg-fill/40 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-fill"
                onClick={() => setOpenMenu(openMenu === "style" ? "" : "style")}
              >
                风格{selectedStyle ? ` · ${selectedStyle.label}` : ""}
              </button>
              {openMenu === "style" ? (
                <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[148px] rounded-xl border border-line bg-surface p-2 shadow-card">
                  <button
                    type="button"
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-fill"
                    onClick={() => {
                      persistPrefs({ styleTemplateId: null });
                      setOpenMenu("");
                    }}
                  >
                    默认
                  </button>
                  {styleTemplates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={[
                        "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                        prefs?.styleTemplateId === t.id ? "bg-brand/10 font-medium" : "hover:bg-fill"
                      ].join(" ")}
                      onClick={() => {
                        persistPrefs({ styleTemplateId: t.id });
                        setOpenMenu("");
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            title="个人特色"
            className={[
              "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              prefs?.personalEnabled ? "border-brand/40 bg-brand/8 text-ink" : "border-line bg-fill/40 text-ink hover:bg-fill"
            ].join(" ")}
            onClick={() => {
              setPersonalDraft(prefs?.personalProfile ?? EMPTY_HOME_COMPOSER_PERSONAL);
              setPersonalOpen(true);
              setOpenMenu("");
            }}
          >
            IP
          </button>

          <button
            type="button"
            disabled={busy || !input.trim()}
            className="ml-auto rounded-lg bg-cta px-3 py-1.5 text-xs font-medium text-cta-foreground disabled:opacity-50"
            onClick={handleSend}
          >
            {busy ? "发送中…" : "发送"}
          </button>
        </div>

        {statusItems.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {statusItems.map((item) => (
              <span key={item} className="rounded-full bg-fill px-2 py-0.5 text-[11px] text-muted">
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {personalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setPersonalOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-ink">个人特色（9 项）</h2>
            <p className="mt-1 text-xs text-muted">保存后默认启用；新对话会继承。</p>
            <div className="mt-4 space-y-3">
              {PERSONAL_FIELDS.map(({ key, label, rows }) => (
                <label key={key} className="block">
                  <span className="text-xs font-medium text-muted">{label}</span>
                  <textarea
                    rows={rows}
                    value={personalDraft[key]}
                    onChange={(e) => setPersonalDraft({ ...personalDraft, [key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1.5 text-sm"
                onClick={() => setPersonalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground"
                onClick={savePersonal}
              >
                保存并启用
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
