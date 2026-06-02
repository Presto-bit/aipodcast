"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeComposerFormatCard from "./HomeComposerFormatCard";
import {
  COMPOSER_CONTENT_MAX_W,
  COMPOSER_OUTER_MAX_W,
  ComposerCopyToast,
  ComposerDropAnchor,
  ComposerKbEmptyHint,
  ComposerShell,
  ComposerStatusBar,
  GeneralAnswerCard,
  IconFormat,
  IconNotes,
  IconStyle,
  IconToolBtn,
  IconUser,
  PersonalProfileCard,
  SessionHistorySidebar,
  UserBubble
} from "./HomeComposerShell";
import {
  activeHomeComposerSession,
  appendHomeComposerTurn,
  createHomeComposerSession,
  deleteHomeComposerSession,
  openHomeComposerOnPageEntry,
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
import { maxNotesForReference } from "../../lib/noteReferenceLimits";
import { readLocalStorageScoped, writeLocalStorageScoped } from "../../lib/userScopedStorage";

const HOME_COMPOSER_SIDEBAR_COLLAPSED_KEY = "fym_home_composer_sidebar_collapsed_v1";

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

function useClickOutside(refs: React.RefObject<HTMLElement | null>[], onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onDoc(e: MouseEvent) {
      if (refs.some((ref) => ref.current?.contains(e.target as Node))) return;
      onOutside();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [active, onOutside, refs]);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const askAbortRef = useRef<AbortController | null>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = readLocalStorageScoped(HOME_COMPOSER_SIDEBAR_COLLAPSED_KEY);
    if (raw === "0") setSidebarCollapsed(false);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      writeLocalStorageScoped(HOME_COMPOSER_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const closeMenus = useCallback(() => setOpenMenu(""), []);
  useClickOutside([composerRootRef], closeMenus, Boolean(openMenu));

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
  const styleUsesNotebookDefault = kbOn && !selectedStyle;
  const [notebookStylePrompt, setNotebookStylePrompt] = useState("");

  useEffect(() => {
    setStore(openHomeComposerOnPageEntry());
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
    const q = new URLSearchParams({ notebook: nb, limit: String(maxNotesForReference()) });
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

  useEffect(() => {
    const nb = prefs?.notebook?.trim();
    if (!nb || notesLoading || !store) return;
    const allIds = notes.map((n) => n.noteId).filter(Boolean);
    if (!allIds.length) {
      if ((prefs?.noteIds?.length ?? 0) > 0) persistPrefs({ noteIds: [] });
      return;
    }
    const cur = prefs?.noteIds ?? [];
    const same = cur.length === allIds.length && allIds.every((id) => cur.includes(id));
    if (!same) persistPrefs({ noteIds: allIds });
  }, [prefs?.notebook, prefs?.noteIds, notes, notesLoading, store, persistPrefs]);

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    window.setTimeout(() => setCopyToast(""), 2600);
  }, []);

  const resolveStylePrompt = useCallback(() => {
    const templateStyle = selectedStyle?.textPrefix?.trim() || "";
    if (kbOn) return templateStyle || notebookStylePrompt;
    return templateStyle;
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

      const turn: HomeComposerTurn = {
        id: turnId,
        userText: q,
        general: { content: "", streaming: true, streamingPhase: "正在连接…" },
        formats: {},
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
            for (const f of formats) fm[f] = { status: "running", progress: "正在准备任务…" };
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

  function openMenuOrToggle(key: MenuKey) {
    if (!key) return;
    setPersonalOpen(false);
    setOpenMenu((m) => (m === key ? "" : key));
  }

  function togglePersonalPanel() {
    if (personalOpen) {
      setPersonalOpen(false);
      return;
    }
    setPersonalDraft(prefs?.personalProfile ?? EMPTY_HOME_COMPOSER_PERSONAL);
    setPersonalOpen(true);
    setOpenMenu("");
  }

  async function copyGeneralAnswer(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showCopyToast("已复制回答");
    } catch {
      showCopyToast("复制失败");
    }
  }

  const sessionListItems = useMemo(
    () => store?.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })) ?? [],
    [store?.sessions]
  );

  const hasPersonalSaved = Boolean(
    prefs?.personalProfile && Object.values(prefs.personalProfile).some((v) => v.trim())
  );

  const formatSelected = (prefs?.formats?.length ?? 0) > 0;

  const statusParts: string[] = [];
  if (prefs?.formats?.length) {
    statusParts.push(`输出格式 · ${prefs.formats.map((f) => HOME_COMPOSER_FORMAT_LABELS[f]).join("、")}`);
  }
  if (kbOn) {
    statusParts.push(`知识库 · ${prefs!.notebook} · 全部资料`);
  }
  if (selectedStyle) {
    statusParts.push(`写作风格 · ${selectedStyle.label}`);
  } else if (styleUsesNotebookDefault) {
    statusParts.push("写作风格 · 笔记本");
  }
  if (prefs?.personalEnabled && prefs.personalProfile) {
    statusParts.push("个人特色");
  }

  if (!store || !session) {
    return (
      <main
        className="mx-auto flex min-h-[50vh] items-center justify-center px-4"
        style={{ maxWidth: COMPOSER_OUTER_MAX_W }}
      >
        <p className="text-sm text-muted">加载创作台…</p>
      </main>
    );
  }

  return (
    <main
      className="relative mx-auto flex h-[calc(100svh-3.5rem)] min-h-0 w-full flex-col overflow-hidden px-3 pb-3 pt-2 sm:h-svh sm:max-h-svh sm:px-4 sm:pb-4"
      style={{ maxWidth: COMPOSER_OUTER_MAX_W }}
    >
      {copyToast ? <ComposerCopyToast message={copyToast} /> : null}

      <div className="flex min-h-0 w-full flex-1 gap-3">
        <SessionHistorySidebar
          collapsed={sidebarCollapsed}
          sessions={sessionListItems}
          activeSessionId={store.activeSessionId}
          onToggleCollapse={toggleSidebarCollapsed}
          onNewSession={() => setStore(createHomeComposerSession(store, session.prefs))}
          onSelectSession={(id) => setStore(selectHomeComposerSession(store, id))}
          onDeleteSession={(id) => setStore(deleteHomeComposerSession(store, id))}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-hidden">
          <div
            className={[
              "flex min-h-0 w-full flex-1 flex-col overflow-hidden",
              hasSent ? "" : "items-center justify-center gap-6"
            ].join(" ")}
            style={{ maxWidth: COMPOSER_CONTENT_MAX_W }}
          >
            {hasSent ? (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pt-1">
                {session.turns.map((turn) => (
                  <div key={turn.id} className="space-y-5">
                    <UserBubble text={turn.userText} />
                    {turn.general ? (
                      <GeneralAnswerCard
                        streaming={turn.general.streaming}
                        streamingPhase={turn.general.streamingPhase}
                        content={turn.general.content}
                        supplementContent={turn.general.supplementContent}
                        onCopy={
                          turn.general.content && !turn.general.streaming
                            ? () => void copyGeneralAnswer(turn.general!.content)
                            : undefined
                        }
                      />
                    ) : null}
                    {(prefs?.formats ?? []).map((format) => {
                      const result = turn.formats[format];
                      if (!result || result.status === "pending") return null;
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
              </div>
            ) : (
              <h1 className="w-full shrink-0 text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                聊想法，复制就能发
              </h1>
            )}

            {error ? (
              <p className="w-full shrink-0 text-sm text-danger-ink" role="alert">
                {error}
              </p>
            ) : null}

            <div
              ref={composerRootRef}
              className={[
                "relative z-10 w-full shrink-0 overflow-visible",
                hasSent ? "pt-2" : ""
              ].join(" ")}
            >
              <ComposerShell
                value={input}
                onChange={setInput}
                onSend={handleSend}
                busy={busy}
                menuOpen={Boolean(openMenu)}
                formatControl={
                  <ComposerDropAnchor
                    title="输出格式"
                    icon={<IconFormat />}
                    open={openMenu === "format"}
                    selected={formatSelected}
                    onToggle={() => openMenuOrToggle("format")}
                    align="left"
                    minWidth={132}
                  >
                    {HOME_COMPOSER_FORMATS.map((f) => (
                      <label
                        key={f.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-fill"
                      >
                        <input
                          type="checkbox"
                          checked={prefs?.formats.includes(f.id) ?? false}
                          onChange={() => toggleFormat(f.id)}
                        />
                        {f.label}
                      </label>
                    ))}
                  </ComposerDropAnchor>
                }
                contextControls={
                  <div className="flex items-center gap-1">
                    <ComposerDropAnchor
                      title="知识库资料"
                      icon={<IconNotes />}
                      open={openMenu === "kb"}
                      selected={kbOn}
                      onToggle={() => openMenuOrToggle("kb")}
                      align="right"
                      minWidth={220}
                    >
                      {notebooks.length === 0 ? (
                        <ComposerKbEmptyHint />
                      ) : (
                        notebooks.map((nb) => (
                          <button
                            key={nb}
                            type="button"
                            className={[
                              "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                              prefs?.notebook === nb ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
                            ].join(" ")}
                            onClick={() => selectNotebook(nb)}
                          >
                            {nb}
                          </button>
                        ))
                      )}
                    </ComposerDropAnchor>

                    <ComposerDropAnchor
                      title="写作风格"
                      icon={<IconStyle />}
                      open={openMenu === "style"}
                      selected={Boolean(selectedStyle) || styleUsesNotebookDefault}
                      onToggle={() => openMenuOrToggle("style")}
                      align="right"
                      minWidth={168}
                    >
                      <button
                        type="button"
                        className={[
                          "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                          styleUsesNotebookDefault ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
                        ].join(" ")}
                        onClick={() => {
                          persistPrefs({ styleTemplateId: null });
                          setOpenMenu("");
                        }}
                      >
                        {kbOn ? "笔记本风格（默认）" : "默认"}
                      </button>
                      {styleTemplates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={[
                            "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                            prefs?.styleTemplateId === t.id ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
                          ].join(" ")}
                          onClick={() => {
                            persistPrefs({ styleTemplateId: t.id });
                            setOpenMenu("");
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </ComposerDropAnchor>

                    <IconToolBtn
                      title="个人特色"
                      selected={Boolean(prefs?.personalEnabled)}
                      onClick={togglePersonalPanel}
                    >
                      <IconUser />
                    </IconToolBtn>
                  </div>
                }
                statusBar={<ComposerStatusBar parts={statusParts} />}
              />
            </div>

            <PersonalProfileCard
              open={personalOpen}
              hasSaved={hasPersonalSaved}
              personalEnabled={Boolean(prefs?.personalEnabled)}
              onToggleEnabled={() => persistPrefs({ personalEnabled: !prefs?.personalEnabled })}
              onClose={() => setPersonalOpen(false)}
              onSave={savePersonal}
              fields={PERSONAL_FIELDS.map(({ key, label, rows }) => ({ key, label, rows }))}
              draft={personalDraft as Record<string, string>}
              onFieldChange={(key, value) =>
                setPersonalDraft((prev) => ({ ...prev, [key as keyof HomeComposerPersonalProfile]: value }))
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
