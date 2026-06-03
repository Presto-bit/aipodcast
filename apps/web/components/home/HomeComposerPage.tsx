"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeComposerFormatCard from "./HomeComposerFormatCard";
import ComposerExpertBlocks from "./ComposerExpertBlocks";
import ComposerFeatureNudgeBar from "./composer/ComposerFeatureNudgeBar";
import {
  COMPOSER_CONTENT_MAX_W,
  ComposerCopyToast,
  ComposerDropAnchor,
  ComposerKbEmptyHint,
  ComposerShell,
  ComposerStatusBar,
  FeatureProfilePanel,
  GeneralAnswerCard,
  IconExpert,
  IconNotes,
  IconStyle,
  IconToolBtn,
  IconUser,
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
  type HomeComposerPersonalProfile,
  type HomeComposerTurn
} from "../../lib/homeComposerTypes";
import { fetchComposerExpertIntake } from "../../lib/homeComposerIntakeApi";
import {
  blocksForConfirmPhase,
  blocksForIntakePhase,
  buildDeliverableBlock,
  buildExpertOutputContextParts,
  buildFeedbackBlock,
  buildProgressBlock,
  canComposerSubmitTask,
  composerInputPlaceholder,
  createExpertTaskDraft
} from "../../lib/homeComposerExpertFlow";
import { expertStripBlock } from "../../lib/composerExpertIntake";
import { runComposerExpertDeliverableJob } from "../../lib/homeComposerExpertJob";
import { trackComposerExpertEvent } from "../../lib/composerExpertAnalytics";
import {
  getExpertEverSelected,
  incrementFeatureNudgeSkipCount,
  markExpertEverSelected,
  shouldShowFeatureNudge
} from "../../lib/composerExpertFeatureNudge";
import {
  inferIntakePreselection,
  intakeTotalSteps,
  mergeIntakeField
} from "../../lib/composerExpertIntake";
import type {
  AssistantBlock,
  ComposerExpertSelection,
  ExpertTaskDraft,
  FeatureCore,
  PlatformExpertId
} from "../../lib/homeComposerExpertTypes";
import {
  COMPOSER_EXPERT_OPTIONS,
  defaultComposerExpertSelection,
  resolveActiveFormats
} from "../../lib/composerExperts";
import {
  backfillFeatureCoreFromProfile,
  EMPTY_FEATURE_CORE,
  featureCoreComplete,
  featureCoreStatusSummary,
  featureCoreToPrompt,
  shouldAutoEnablePersonalFeature
} from "../../lib/homeComposerFeatureCore";
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

type MenuKey = "expert" | "kb" | "style" | "";

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
  const [featureNudgeVisible, setFeatureNudgeVisible] = useState(false);
  const [featureNudgeExpertId, setFeatureNudgeExpertId] = useState<PlatformExpertId | null>(null);
  const [personalDraft, setPersonalDraft] = useState<HomeComposerPersonalProfile>(EMPTY_HOME_COMPOSER_PERSONAL);
  const [featureCoreDraft, setFeatureCoreDraft] = useState<FeatureCore>(EMPTY_FEATURE_CORE);
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
          const featureCore = backfillFeatureCoreFromProfile(active.prefs.featureCore, profile);
          return patchActiveHomeComposerSession(prev, {
            prefs: {
              ...active.prefs,
              personalProfile: profile,
              featureCore
            }
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
    if (prefs?.writingHabitMode === "off") return "";
    const templateStyle = selectedStyle?.textPrefix?.trim() || "";
    if (prefs?.writingHabitMode === "template") return templateStyle;
    if (prefs?.writingHabitMode === "notebook" || styleUsesNotebookDefault) {
      return templateStyle || notebookStylePrompt;
    }
    if (prefs?.writingHabitMode === "neutral") return templateStyle;
    if (kbOn) return templateStyle || notebookStylePrompt;
    return templateStyle;
  }, [kbOn, notebookStylePrompt, prefs?.writingHabitMode, selectedStyle, styleUsesNotebookDefault]);

  const resolveAuthorPrompt = useCallback(() => {
    if (!prefs?.personalEnabled) return "";
    const corePrompt = featureCoreToPrompt(prefs.featureCore);
    const supplemental = prefs.personalProfile ? personalProfileToPrompt(prefs.personalProfile) : "";
    return [corePrompt, supplemental].filter(Boolean).join("\n\n");
  }, [prefs?.featureCore, prefs?.personalEnabled, prefs?.personalProfile]);

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

        const activeFormats = resolveActiveFormats(prefs);
        if (activeFormats.length) {
          nextStore = updateHomeComposerTurn(nextStore, turnId, (t) => {
            const fm = { ...t.formats };
            for (const f of activeFormats) fm[f] = { status: "running", progress: "正在准备任务…" };
            return { ...t, formats: fm };
          });
          setStore(nextStore);

          const noteTitleById = Object.fromEntries(notes.map((n) => [n.noteId, n.title || ""]));
          const results = await runHomeComposerFormatJobs(
            activeFormats,
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

  const patchTaskDraftTurn = useCallback(
    (turnId: string, draft: ExpertTaskDraft, prefsSnapshot: NonNullable<typeof prefs>) => {
      const blocks =
        draft.phase === "confirm"
          ? blocksForConfirmPhase(draft.expertId, draft.taskSentence, draft.intake, prefsSnapshot)
          : blocksForIntakePhase(draft.expertId, draft.intakeStep, draft.intake, draft.taskSentence);
      setStore((prev) => {
        if (!prev) return prev;
        const withDraft = patchActiveHomeComposerSession(prev, (s) => ({
          ...s,
          prefs: { ...s.prefs, taskDraft: draft }
        }));
        return updateHomeComposerTurn(withDraft, turnId, { blocks });
      });
    },
    []
  );

  const runExpertTurn = useCallback(
    async (userText: string) => {
      if (!store || !session || !prefs || prefs.expert.mode !== "platform") return;
      if (!isLoggedIn) {
        setError("请先登录后再发送");
        return;
      }
      const q = userText.trim();
      if (!q) return;

      setError("");
      setBusy(true);
      const turnId = crypto.randomUUID();
      const expertId = prefs.expert.expertId;

      let intake = inferIntakePreselection(expertId, q).intake;
      let skipStep2 = inferIntakePreselection(expertId, q).skipStep2;
      let blocks = blocksForIntakePhase(expertId, 0, intake, q);

      try {
        try {
          const api = await fetchComposerExpertIntake(
            {
              expertId,
              taskSentence: q,
              intakeStep: 0,
              intake: {},
              notebook: prefs.notebook,
              noteCount: prefs.noteIds.length,
              featureCore: prefs.featureCore,
              personalEnabled: prefs.personalEnabled
            },
            getAuthHeaders()
          );
          intake = { ...intake, ...api.preselected };
          skipStep2 = api.skipStep2;
          blocks = [api.expertStrip, api.intakeStep];
        } catch {
          // 后端不可用时走客户端规则 fallback
        }

        const draft = createExpertTaskDraft({
          expertId,
          taskSentence: q,
          turnId,
          intake,
          intakeStep: 0,
          phase: "intake"
        });
        draft.skipStep2 = skipStep2;

        const turn: HomeComposerTurn = {
          id: turnId,
          userText: q,
          formats: {},
          blocks,
          createdAt: Date.now()
        };

        let nextStore = appendHomeComposerTurn(store, turn);
        nextStore = patchActiveHomeComposerSession(nextStore, (s) => ({
          ...s,
          prefs: { ...s.prefs, taskDraft: draft }
        }));
        setStore(nextStore);
        setInput("");
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err));
      } finally {
        setBusy(false);
      }
    },
    [store, session, prefs, isLoggedIn, getAuthHeaders]
  );

  const goToConfirm = useCallback(
    (turnId: string, draft: ExpertTaskDraft) => {
      if (!prefs) return;
      const nextDraft: ExpertTaskDraft = {
        ...draft,
        phase: "confirm",
        updatedAt: new Date().toISOString()
      };
      patchTaskDraftTurn(turnId, nextDraft, prefs);
    },
    [patchTaskDraftTurn, prefs]
  );

  const handleIntakeFieldChange = useCallback(
    (fieldId: string, value: string | string[], multi: boolean) => {
      const draft = prefs?.taskDraft;
      if (!draft || draft.phase !== "intake") return;
      const intake = mergeIntakeField(draft.intake, fieldId, value, multi);
      const nextDraft: ExpertTaskDraft = { ...draft, intake, updatedAt: new Date().toISOString() };
      patchTaskDraftTurn(draft.turnId, nextDraft, prefs!);
    },
    [patchTaskDraftTurn, prefs]
  );

  const handleIntakeNext = useCallback(() => {
    const draft = prefs?.taskDraft;
    if (!draft || draft.phase !== "intake" || !prefs) return;
    const total = intakeTotalSteps(draft.expertId);
    const nextStep = draft.intakeStep + 1;
    if (draft.skipStep2 || nextStep >= total) {
      goToConfirm(draft.turnId, draft);
      return;
    }
    const nextDraft: ExpertTaskDraft = {
      ...draft,
      intakeStep: nextStep,
      updatedAt: new Date().toISOString()
    };
    patchTaskDraftTurn(draft.turnId, nextDraft, prefs);
  }, [goToConfirm, patchTaskDraftTurn, prefs]);

  const handleIntakeConfirmDirect = useCallback(() => {
    const draft = prefs?.taskDraft;
    if (!draft) return;
    goToConfirm(draft.turnId, draft);
  }, [goToConfirm, prefs?.taskDraft]);

  const handleConfirmEditIntake = useCallback(() => {
    const draft = prefs?.taskDraft;
    if (!draft || !prefs) return;
    const nextDraft: ExpertTaskDraft = {
      ...draft,
      phase: "intake",
      intakeStep: 0,
      updatedAt: new Date().toISOString()
    };
    patchTaskDraftTurn(draft.turnId, nextDraft, prefs);
  }, [patchTaskDraftTurn, prefs]);

  const handleConfirmStartGenerate = useCallback(async () => {
    const draft = prefs?.taskDraft;
    if (!draft || draft.phase !== "confirm" || !prefs || prefs.expert.mode !== "platform") return;
    if (!isLoggedIn) {
      setError("请先登录后再生成");
      return;
    }

    setError("");
    setBusy(true);
    trackComposerExpertEvent("confirm_start", { expertId: draft.expertId });
    const expertId = draft.expertId;
    const hasNotes = Boolean(prefs.noteIds.length > 0 && prefs.notebook.trim());
    const generateDraft: ExpertTaskDraft = {
      ...draft,
      phase: "generate",
      updatedAt: new Date().toISOString()
    };

    setStore((prev) => {
      if (!prev) return prev;
      const withDraft = patchActiveHomeComposerSession(prev, (s) => ({
        ...s,
        prefs: { ...s.prefs, taskDraft: generateDraft }
      }));
      return updateHomeComposerTurn(withDraft, draft.turnId, {
        blocks: [expertStripBlock(expertId), buildProgressBlock("正在启动…", 8, hasNotes)]
      });
    });

    const result = await runComposerExpertDeliverableJob({
      expertId: draft.expertId,
      taskSentence: draft.taskSentence,
      intake: draft.intake,
      notebook: prefs.notebook,
      noteIds: prefs.noteIds,
      featureCore: prefs.featureCore,
      stylePrompt: resolveStylePrompt(),
      authorPrompt: resolveAuthorPrompt(),
      authHeaders: getAuthHeaders(),
      createdBy: createdByPhone,
      onProgress: (msg, prog) => {
        setStore((prev) =>
          prev
            ? updateHomeComposerTurn(prev, draft.turnId, {
                blocks: [expertStripBlock(expertId), buildProgressBlock(msg, prog ?? 55, hasNotes)]
              })
            : prev
        );
      }
    });

    if (result.status === "done") {
      setStore((prev) => {
        if (!prev) return prev;
        const withCleared = patchActiveHomeComposerSession(prev, (s) => ({
          ...s,
          prefs: { ...s.prefs, taskDraft: undefined, lastDeliverableId: result.jobId }
        }));
        return updateHomeComposerTurn(withCleared, draft.turnId, {
          blocks: [
            expertStripBlock(expertId),
            buildDeliverableBlock(expertId, result.deliverable),
            buildFeedbackBlock(result.jobId, expertId, hasNotes)
          ],
          expertJobId: result.jobId
        });
      });
      showCopyToast("内容成品已生成");
    } else {
      setError(result.error);
      setStore((prev) => {
        if (!prev) return prev;
        const backConfirm: ExpertTaskDraft = {
          ...draft,
          phase: "confirm",
          updatedAt: new Date().toISOString()
        };
        const withDraft = patchActiveHomeComposerSession(prev, (s) => ({
          ...s,
          prefs: { ...s.prefs, taskDraft: backConfirm }
        }));
        return updateHomeComposerTurn(withDraft, draft.turnId, {
          blocks: blocksForConfirmPhase(expertId, draft.taskSentence, draft.intake, prefs)
        });
      });
    }
    setBusy(false);
  }, [
    prefs,
    isLoggedIn,
    getAuthHeaders,
    createdByPhone,
    resolveStylePrompt,
    resolveAuthorPrompt,
    showCopyToast
  ]);

  const activeFeatureCoreComplete =
    prefs?.personalEnabled && prefs.featureCore ? featureCoreComplete(prefs.featureCore) : 0;

  type FeedbackPatch = Partial<Extract<AssistantBlock, { kind: "feedback" }>>;

  const patchTurnFeedback = useCallback(
    (turnId: string, patch: FeedbackPatch) => {
      setStore((prev) => {
        if (!prev) return prev;
        const session = activeHomeComposerSession(prev);
        const turn = session?.turns.find((t) => t.id === turnId);
        if (!turn?.blocks?.length) return prev;
        const blocks = turn.blocks.map((b) => (b.kind === "feedback" ? { ...b, ...patch } : b));
        return updateHomeComposerTurn(prev, turnId, { blocks });
      });
    },
    []
  );

  const handleExpertFeedback = useCallback(
    (
      turnId: string,
      expertId: PlatformExpertId,
      patch: FeedbackPatch,
      deliverableId?: string
    ) => {
      patchTurnFeedback(turnId, patch);
      if (patch.submitted === "positive") {
        trackComposerExpertEvent("feedback", {
          expertId,
          sentiment: "positive",
          deliverableId
        });
      } else if (patch.submitted === "negative") {
        trackComposerExpertEvent("feedback", {
          expertId,
          sentiment: "negative",
          reason: patch.negativeReason,
          deliverableId
        });
      } else if (patch.selectedChip) {
        trackComposerExpertEvent("feedback", {
          expertId,
          chip: patch.selectedChip,
          deliverableId
        });
      }
    },
    [patchTurnFeedback]
  );

  function dismissFeatureNudge(skip: boolean) {
    if (skip) incrementFeatureNudgeSkipCount();
    setFeatureNudgeVisible(false);
    setFeatureNudgeExpertId(null);
  }

  function openFeatureFromNudge() {
    dismissFeatureNudge(false);
    setPersonalOpen(true);
  }

  const handleExitExpertTask = useCallback(() => {
    const draft = prefs?.taskDraft;
    if (!draft) return;
    setStore((prev) => {
      if (!prev) return prev;
      let next = updateHomeComposerTurn(prev, draft.turnId, { taskFlowArchived: true });
      next = patchActiveHomeComposerSession(next, {
        prefs: {
          ...activeHomeComposerSession(next)!.prefs,
          expert: defaultComposerExpertSelection(),
          taskDraft: undefined
        }
      });
      return next;
    });
    setOpenMenu("");
  }, [prefs?.taskDraft]);

  useEffect(() => {
    if (!prefs?.taskDraft || prefs.taskDraft.phase !== "generate") return;
    const draft = prefs.taskDraft;
    persistPrefs({
      taskDraft: { ...draft, phase: "confirm", updatedAt: new Date().toISOString() }
    });
    patchTaskDraftTurn(draft.turnId, { ...draft, phase: "confirm" }, prefs);
    showCopyToast("上次未完成生成，已回到确认页");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅会话切换时恢复中断态
  }, [store?.activeSessionId]);

  function handleSend() {
    if (prefs?.expert.mode === "platform" && canComposerSubmitTask(prefs.taskDraft)) {
      void runExpertTurn(input);
      return;
    }
    if (!canComposerSubmitTask(prefs?.taskDraft)) return;
    void runTurn(input);
  }

  function togglePersonalEnabled() {
    const nextEnabled = !prefs?.personalEnabled;
    persistPrefs({
      personalEnabled: nextEnabled,
      personalDisabledByUser: nextEnabled ? false : true
    });
  }

  function fillExpertExample(text: string) {
    setInput(text);
    setOpenMenu("");
  }

  function selectExpert(next: ComposerExpertSelection) {
    const isFirstPlatform = next.mode === "platform" && !getExpertEverSelected();

    setStore((prev) => {
      if (!prev) return prev;
      const active = activeHomeComposerSession(prev);
      const draft = active?.prefs.taskDraft;
      let nextStore = draft
        ? updateHomeComposerTurn(prev, draft.turnId, { taskFlowArchived: true })
        : prev;
      return patchActiveHomeComposerSession(nextStore, (s) => ({
        ...s,
        prefs: { ...s.prefs, expert: next, formats: [], taskDraft: undefined }
      }));
    });
    setOpenMenu("");

    if (next.mode === "platform") {
      trackComposerExpertEvent("expert_selected", { expertId: next.expertId });
      if (isFirstPlatform) {
        markExpertEverSelected();
        if (
          shouldShowFeatureNudge({
            isFirstExpertSelect: true,
            featureCore: prefs?.featureCore,
            personalEnabled: Boolean(prefs?.personalEnabled),
            personalProfile: prefs?.personalProfile
          })
        ) {
          setFeatureNudgeVisible(true);
          setFeatureNudgeExpertId(next.expertId);
        }
      }
    } else {
      setFeatureNudgeVisible(false);
      setFeatureNudgeExpertId(null);
    }
  }

  function applyWritingHabit(
    mode: "neutral" | "notebook" | "template" | "off",
    templateId: string | null = null
  ) {
    persistPrefs({
      writingHabitMode: mode,
      styleTemplateId: mode === "template" ? templateId : null
    });
    setOpenMenu("");
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
    const featureCore = {
      who: featureCoreDraft.who.trim(),
      remember: featureCoreDraft.remember.trim(),
      avoid: featureCoreDraft.avoid.trim()
    };
    const personalProfile = { ...personalDraft };
    const autoEnable = shouldAutoEnablePersonalFeature(featureCore, prefs?.personalDisabledByUser);
    persistPrefs({
      personalProfile,
      featureCore,
      personalEnabled: autoEnable ? true : Boolean(prefs?.personalEnabled)
    });
    setPersonalOpen(false);
    if (defaultIpId) {
      void saveDefaultAuthorIpProfile(defaultIpId, personalProfile).catch(() => {
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
    const profile = prefs?.personalProfile ?? EMPTY_HOME_COMPOSER_PERSONAL;
    setPersonalDraft(profile);
    setFeatureCoreDraft(backfillFeatureCoreFromProfile(prefs?.featureCore, profile));
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
    () =>
      store?.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        empty: s.turns.length === 0
      })) ?? [],
    [store?.sessions]
  );

  const featureCoreFilled = featureCoreComplete(prefs?.featureCore) > 0;
  const featureSummary = featureCoreStatusSummary(prefs?.featureCore);
  const expertSelected = prefs?.expert?.mode === "platform";
  const activeFormats = resolveActiveFormats(prefs);

  const hasPersonalSaved = Boolean(
    featureCoreFilled ||
      (prefs?.personalProfile && Object.values(prefs.personalProfile).some((v) => v.trim()))
  );

  const writingHabitLabel = useMemo(() => {
    if (prefs?.writingHabitMode === "off") return "不套用";
    if (prefs?.writingHabitMode === "neutral") return "通用客观";
    if (prefs?.writingHabitMode === "template" && selectedStyle) return selectedStyle.label;
    if (prefs?.writingHabitMode === "notebook" || styleUsesNotebookDefault) return kbOn ? "笔记本风格" : "通用客观";
    if (selectedStyle) return selectedStyle.label;
    return "通用客观";
  }, [kbOn, prefs?.writingHabitMode, selectedStyle, styleUsesNotebookDefault]);

  const selectedExpertId = prefs?.expert.mode === "platform" ? prefs.expert.expertId : null;

  const expertOutputContext = useMemo(() => {
    if (!selectedExpertId || !prefs) return undefined;
    return buildExpertOutputContextParts({
      expertId: selectedExpertId,
      writingHabitLabel,
      featureSummary: featureSummary || undefined,
      featureEnabled: Boolean(prefs.personalEnabled && featureCoreFilled),
      notebook: kbOn ? prefs.notebook : undefined
    });
  }, [
    selectedExpertId,
    prefs,
    writingHabitLabel,
    featureSummary,
    featureCoreFilled,
    kbOn
  ]);

  const statusParts: string[] = [];
  if (!expertSelected) {
    if (kbOn) {
      statusParts.push(`资料 · ${prefs!.notebook} · 全部`);
    }
    statusParts.push(`写作习惯 · ${writingHabitLabel}`);
    if (prefs?.personalEnabled && featureSummary) {
      statusParts.push(`我的特色 · ${featureSummary}`);
    }
  }

  if (!store || !session) {
    return (
      <main className="flex min-h-[50vh] w-full items-center justify-center px-4">
        <p className="text-sm text-muted">加载创作台…</p>
      </main>
    );
  }

  return (
    <main
      className="relative flex h-[calc(100svh-3.5rem)] min-h-0 w-full flex-col overflow-hidden pb-3 sm:h-svh sm:max-h-svh"
    >
      {copyToast ? <ComposerCopyToast message={copyToast} /> : null}

      <div className="flex min-h-0 w-full flex-1">
        <SessionHistorySidebar
          collapsed={sidebarCollapsed}
          sessions={sessionListItems}
          activeSessionId={store.activeSessionId}
          onToggleCollapse={toggleSidebarCollapsed}
          onNewSession={() => setStore(createHomeComposerSession(store, session.prefs))}
          onSelectSession={(id) => setStore(selectHomeComposerSession(store, id))}
          onDeleteSession={(id) => setStore(deleteHomeComposerSession(store, id))}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-hidden px-3 pt-2 sm:px-4">
          <div
            className={[
              "flex min-h-0 w-full flex-1 flex-col overflow-hidden",
              hasSent ? "" : "items-center justify-center gap-6"
            ].join(" ")}
            style={{ maxWidth: COMPOSER_CONTENT_MAX_W }}
          >
            {hasSent ? (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pt-1">
                {session.turns.map((turn) => {
                  const isActiveExpertTurn = prefs?.taskDraft?.turnId === turn.id;
                  const deliverableBlock = turn.blocks?.find((b) => b.kind === "deliverable");
                  const expertId =
                    deliverableBlock && deliverableBlock.kind === "deliverable"
                      ? deliverableBlock.expertId
                      : isActiveExpertTurn && prefs?.taskDraft
                        ? prefs.taskDraft.expertId
                        : prefs?.expert.mode === "platform"
                          ? prefs.expert.expertId
                          : null;
                  return (
                  <div key={turn.id} className="space-y-5">
                    <UserBubble text={turn.userText} />
                    {turn.blocks?.length && expertId ? (
                      <ComposerExpertBlocks
                        blocks={turn.blocks}
                        expertId={expertId}
                        archived={turn.taskFlowArchived}
                        draft={isActiveExpertTurn ? prefs?.taskDraft : undefined}
                        onIntakeChange={handleIntakeFieldChange}
                        onIntakeNext={handleIntakeNext}
                        onIntakeConfirmDirect={handleIntakeConfirmDirect}
                        onConfirmStart={handleConfirmStartGenerate}
                        onConfirmEditIntake={handleConfirmEditIntake}
                        onExitChat={handleExitExpertTask}
                        onEditFeature={togglePersonalPanel}
                        onCopyToast={showCopyToast}
                        featureCoreComplete={activeFeatureCoreComplete}
                        outputContextParts={expertOutputContext}
                        onFeedbackPatch={(patch) => {
                          const fb = turn.blocks?.find((b) => b.kind === "feedback");
                          handleExpertFeedback(
                            turn.id,
                            expertId,
                            patch,
                            fb?.kind === "feedback" ? fb.deliverableId : undefined
                          );
                        }}
                      />
                    ) : null}
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
                    {activeFormats.map((format) => {
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
                  );
                })}
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
              {featureNudgeVisible && featureNudgeExpertId ? (
                <ComposerFeatureNudgeBar
                  expertId={featureNudgeExpertId}
                  onFillFeature={openFeatureFromNudge}
                  onSkip={() => dismissFeatureNudge(true)}
                />
              ) : null}
              <ComposerShell
                value={input}
                onChange={setInput}
                onSend={handleSend}
                busy={busy}
                menuOpen={Boolean(openMenu)}
                placeholder={composerInputPlaceholder(prefs?.taskDraft)}
                sendDisabled={!canComposerSubmitTask(prefs?.taskDraft)}
                formatControl={
                  <ComposerDropAnchor
                    title="专家"
                    icon={<IconExpert />}
                    open={openMenu === "expert"}
                    selected={expertSelected}
                    onToggle={() => openMenuOrToggle("expert")}
                    align="left"
                    minWidth={280}
                  >
                    {COMPOSER_EXPERT_OPTIONS.map((opt) => {
                      const selected =
                        opt.id === "none"
                          ? prefs?.expert?.mode === "none"
                          : prefs?.expert?.mode === "platform" && prefs.expert.expertId === opt.id;
                      return (
                        <div key={opt.id} className="border-b border-line/50 last:border-0">
                          <button
                            type="button"
                            className={[
                              "block w-full rounded-lg px-2 py-1.5 text-left",
                              selected ? "bg-brand/10" : "hover:bg-fill"
                            ].join(" ")}
                            onClick={() =>
                              selectExpert(
                                opt.id === "none"
                                  ? { mode: "none" }
                                  : { mode: "platform", expertId: opt.id as PlatformExpertId }
                              )
                            }
                          >
                            <span className={["block text-sm", selected ? "font-medium text-ink" : "text-ink"].join(" ")}>
                              {opt.name}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">{opt.description}</span>
                          </button>
                        </div>
                      );
                    })}
                    {selectedExpertId ? (
                      <div className="mt-2 border-t border-line/70 pt-2">
                        <p className="px-1 text-[11px] font-medium text-muted">试试这样写</p>
                        {(COMPOSER_EXPERT_OPTIONS.find((o) => o.id === selectedExpertId)?.examples ?? []).map(
                          (example) => (
                            <button
                              key={example}
                              type="button"
                              className="mt-1 block w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink hover:bg-fill"
                              onClick={() => fillExpertExample(example)}
                            >
                              {example}
                            </button>
                          )
                        )}
                      </div>
                    ) : null}
                  </ComposerDropAnchor>
                }
                contextControls={
                  <div className="flex items-center gap-1">
                    <ComposerDropAnchor
                      title="资料"
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
                      title="写作习惯"
                      icon={<IconStyle />}
                      open={openMenu === "style"}
                      selected={prefs?.writingHabitMode !== "off"}
                      onToggle={() => openMenuOrToggle("style")}
                      align="right"
                      minWidth={188}
                    >
                      <p className="pointer-events-none px-2 py-1 text-xs text-muted">管写法，不管你是谁</p>
                      <button
                        type="button"
                        className={[
                          "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                          prefs?.writingHabitMode === "neutral" ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
                        ].join(" ")}
                        onClick={() => applyWritingHabit("neutral")}
                      >
                        通用客观
                      </button>
                      {kbOn ? (
                        <button
                          type="button"
                          className={[
                            "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                            prefs?.writingHabitMode === "notebook" || styleUsesNotebookDefault
                              ? "bg-brand/10 font-medium text-ink"
                              : "text-ink hover:bg-fill"
                          ].join(" ")}
                          onClick={() => applyWritingHabit("notebook")}
                        >
                          笔记本风格
                        </button>
                      ) : null}
                      {styleTemplates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={[
                            "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                            prefs?.writingHabitMode === "template" && prefs?.styleTemplateId === t.id
                              ? "bg-brand/10 font-medium text-ink"
                              : "text-ink hover:bg-fill"
                          ].join(" ")}
                          onClick={() => applyWritingHabit("template", t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={[
                          "block w-full rounded-lg px-2 py-1.5 text-left text-sm",
                          prefs?.writingHabitMode === "off" ? "bg-brand/10 font-medium text-ink" : "text-ink hover:bg-fill"
                        ].join(" ")}
                        onClick={() => applyWritingHabit("off")}
                      >
                        不套用习惯
                      </button>
                    </ComposerDropAnchor>

                    <IconToolBtn
                      title="我的特色 · 我是谁"
                      selected={Boolean(prefs?.personalEnabled && featureCoreFilled)}
                      dashed={!featureCoreFilled}
                      badgeDot={Boolean(prefs?.personalEnabled && featureCoreFilled)}
                      onClick={togglePersonalPanel}
                    >
                      <IconUser />
                    </IconToolBtn>
                  </div>
                }
                statusBar={<ComposerStatusBar parts={statusParts} />}
              />
            </div>

            <FeatureProfilePanel
              open={personalOpen}
              hasSaved={hasPersonalSaved || featureCoreFilled}
              personalEnabled={Boolean(prefs?.personalEnabled)}
              onToggleEnabled={togglePersonalEnabled}
              onClose={() => setPersonalOpen(false)}
              onSave={savePersonal}
              featureCore={featureCoreDraft}
              onFeatureCoreChange={(key, value) => setFeatureCoreDraft((prev) => ({ ...prev, [key]: value }))}
              supplementalFields={PERSONAL_FIELDS.map(({ key, label, rows }) => ({ key, label, rows }))}
              supplementalDraft={personalDraft as Record<string, string>}
              onSupplementalFieldChange={(key, value) =>
                setPersonalDraft((prev) => ({ ...prev, [key as keyof HomeComposerPersonalProfile]: value }))
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
