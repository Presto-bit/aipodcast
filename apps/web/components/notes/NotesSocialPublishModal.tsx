"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChevronLeft, IconClipboard, IconX } from "../icons";
import { fetchSocialPublishDraft } from "../../lib/socialPublishApi";
import {
  buildOptionsPayload,
  clampTargetChars,
  defaultAdvancedOptions,
  defaultPersonaOptions,
  defaultQuickOptions,
  isPersonaValid,
  platformLabel,
  publishPresetBundle,
  SOCIAL_PUBLISH_CHARS_PRESETS,
  toggleMultiSelect,
  SOCIAL_TARGET_CHARS_MAX,
  SOCIAL_TARGET_CHARS_MIN,
  charsFromPreset
} from "../../lib/socialPublishPresets";
import { buildSocialPublishClipboardText, copyGuideLines } from "../../lib/socialPublishCopy";
import { loadSocialPublishPrefs, saveSocialPublishPrefs } from "../../lib/socialPublishStorage";
import type {
  SocialPublishAdvancedOptions,
  SocialPublishDraft,
  SocialPublishPersonaOptions,
  SocialPublishPlatform,
  SocialPublishQuickOptions,
  SocialPublishWizardStep
} from "../../lib/socialPublishTypes";
import { NotesSocialPublishStudio } from "./NotesSocialPublishStudio";

type Props = {
  open: boolean;
  onClose: () => void;
  notebook: string;
  noteIds: string[];
  selectedNoteTitles?: string[];
  notesSourceOwnerUserId?: string | null;
  authHeaders: Record<string, string>;
  /** 本笔记本已提炼的写作风格，并入写作人设 */
  notebookStylePrompt?: string;
  /** 与风格弹窗一致的关键词 chips（最多展示 4 个） */
  notebookStyleChips?: string[];
  /** 风格名称（可改名后的 displayName） */
  notebookStyleName?: string;
};

const inputCls =
  "rounded-lg border border-line bg-fill p-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export default function NotesSocialPublishModal({
  open,
  onClose,
  notebook,
  noteIds,
  selectedNoteTitles = [],
  notesSourceOwnerUserId = null,
  authHeaders,
  notebookStylePrompt = "",
  notebookStyleChips = [],
  notebookStyleName = ""
}: Props) {
  const prefs = useMemo(() => loadSocialPublishPrefs(), [open]);
  const [step, setStep] = useState<SocialPublishWizardStep>("platform");
  const [platform, setPlatform] = useState<SocialPublishPlatform>(prefs.platform);
  const [quick, setQuick] = useState<SocialPublishQuickOptions>(prefs.quick);
  const [advanced, setAdvanced] = useState<SocialPublishAdvancedOptions>(() =>
    defaultAdvancedOptions(prefs.platform)
  );
  const [persona, setPersona] = useState<SocialPublishPersonaOptions>(() =>
    defaultPersonaOptions(prefs.platform)
  );
  const [targetCharsInput, setTargetCharsInput] = useState("600");
  const [draft, setDraft] = useState<SocialPublishDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyToast, setCopyToast] = useState("");
  const [showStudio, setShowStudio] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const hasNotebookStyle = Boolean(notebookStylePrompt.trim());
  const styleChipsPreview = useMemo(
    () => notebookStyleChips.filter(Boolean).slice(0, 4),
    [notebookStyleChips]
  );
  const notebookStyleCardHint =
    styleChipsPreview.length > 0
      ? styleChipsPreview.join(" · ")
      : notebookStylePrompt.trim().slice(0, 72) +
        (notebookStylePrompt.trim().length > 72 ? "…" : "");
  const notebookStyleCardTitle = (notebookStyleName || "本笔记本风格").trim();
  const [useNotebookPersona, setUseNotebookPersona] = useState(true);

  const preset = useMemo(() => publishPresetBundle(platform), [platform]);

  const canGenerate = noteIds.length > 0;

  useEffect(() => {
    if (!open) return;
    const p = loadSocialPublishPrefs();
    setPlatform(p.platform);
    setQuick(p.quick);
    setTargetCharsInput(String(p.quick.targetChars));
    setAdvanced(defaultAdvancedOptions(p.platform));
    setPersona(defaultPersonaOptions(p.platform));
    setStep("platform");
    setDraft(null);
    setError("");
    setBusy(false);
    setShowStudio(false);
    setShowGuide(false);
    setUseNotebookPersona(Boolean(notebookStylePrompt.trim()));
  }, [open, noteIds, notebookStylePrompt]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  const quickForPayload = useMemo(
    (): SocialPublishQuickOptions => ({
      ...quick,
      targetChars: charsFromPreset(
        quick.targetCharsPreset,
        Number(targetCharsInput) || quick.targetChars
      )
    }),
    [quick, targetCharsInput]
  );

  const personaValid = isPersonaValid(persona);

  const handlePlatformPick = (p: SocialPublishPlatform) => {
    setPlatform(p);
    const q = defaultQuickOptions(p);
    setQuick(q);
    setTargetCharsInput(String(q.targetChars));
    setAdvanced(defaultAdvancedOptions(p));
    setPersona(defaultPersonaOptions(p));
    setStep("options");
  };

  function commitTargetCharsInput() {
    const parsed = Number(targetCharsInput);
    if (Number.isNaN(parsed)) {
      setTargetCharsInput(String(quick.targetChars));
      return;
    }
    const clamped = clampTargetChars(parsed);
    setTargetCharsInput(String(clamped));
    setQuick((q) => ({ ...q, targetChars: clamped }));
  }

  const runGenerate = useCallback(async () => {
    if (!canGenerate) {
      setError("请先勾选左侧参考资料");
      return;
    }
    setBusy(true);
    setError("");
    setStep("generating");
    try {
      const personaForPayload =
        useNotebookPersona && notebookStylePrompt.trim()
          ? {
              ...persona,
              writerVoice: null,
              otherRequirements: [notebookStylePrompt.trim(), persona.otherRequirements.trim()]
                .filter(Boolean)
                .join("\n\n")
            }
          : persona;
      const options = buildOptionsPayload(quickForPayload, advanced, personaForPayload, platform);
      const result = await fetchSocialPublishDraft({
        platform,
        options,
        sourceType: "notes_rag",
        authHeaders,
        selectedNoteIds: noteIds,
        selectedNoteTitles,
        notesSourceOwnerUserId
      });
      setDraft(result);
      saveSocialPublishPrefs(platform, quickForPayload);
      setStep("result");
      setShowStudio(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setStep("options");
    } finally {
      setBusy(false);
    }
  }, [
    canGenerate,
    authHeaders,
    noteIds,
    selectedNoteTitles,
    notesSourceOwnerUserId,
    quickForPayload,
    advanced,
    platform,
    persona,
    useNotebookPersona,
    notebookStylePrompt
  ]);

  function chipBtn(active: boolean) {
    return `rounded-full border px-2.5 py-1 text-xs ${
      active ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"
    }`;
  }

  async function copyPublishPack() {
    if (!draft) return;
    const text = buildSocialPublishClipboardText(draft);
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast("已复制发布包，请按下方指引粘贴到平台");
      setShowGuide(true);
    } catch {
      setError("复制失败，请检查浏览器权限");
    }
  }

  if (!open) return null;

  if (showStudio && draft) {
    return (
      <NotesSocialPublishStudio
        draft={draft}
        onDraftChange={setDraft}
        onBack={() => setShowStudio(false)}
        onClose={onClose}
        onCopy={copyPublishPack}
      />
    );
  }

  return (
    <div
      className="fym-workspace-scrim z-[530] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="social-publish-title"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="max-h-[min(90vh,760px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-modal"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="social-publish-title" className="text-base font-semibold text-ink">
              发布到自媒体
            </h2>
            <p className="mt-0.5 text-[11px] text-muted">预览与复制，需自行在平台 App 内粘贴发布</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-muted hover:bg-fill"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <IconX width={18} height={18} />
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger-soft/40 px-2.5 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        {step === "platform" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">选择平台</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "xiaohongshu" as const, label: "小红书", hint: "标题·正文·话题·封面建议" },
                  { id: "wechat_mp" as const, label: "微信公众号", hint: "标题·摘要·分节正文" }
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-xl border border-line bg-fill/80 p-3 text-left transition hover:border-brand/45 hover:bg-surface"
                  onClick={() => handlePlatformPick(p.id)}
                >
                  <span className="text-sm font-semibold text-ink">{p.label}</span>
                  <span className="mt-1 block text-[10px] leading-snug text-muted">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "options" ? (
          <div className="mt-4 space-y-4">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
              onClick={() => setStep("platform")}
            >
              <IconChevronLeft width={14} height={14} />
              换平台
            </button>
            <>
              <details className="rounded-xl border border-brand/20 bg-brand/5 p-2.5" open>
                <summary className="cursor-pointer text-xs font-semibold text-ink">目标人群定位</summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1 text-[11px] text-ink">性别</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preset.genders.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={chipBtn(persona.genders.includes(o.id))}
                          onClick={() =>
                            setPersona((p) => ({
                              ...p,
                              genders: toggleMultiSelect(p.genders, o.id, "any")
                            }))
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-ink">年龄段</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preset.ages.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={chipBtn(persona.ageRanges.includes(o.id))}
                          onClick={() =>
                            setPersona((p) => ({
                              ...p,
                              ageRanges: toggleMultiSelect(p.ageRanges, o.id, "all_ages")
                            }))
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-ink">地域</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preset.regions.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={chipBtn(persona.regions.includes(o.id))}
                          onClick={() =>
                            setPersona((p) => ({
                              ...p,
                              regions: toggleMultiSelect(p.regions, o.id, "any")
                            }))
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-ink">兴趣爱好</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preset.interests.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={chipBtn(persona.interests.includes(o.id))}
                          onClick={() =>
                            setPersona((p) => ({
                              ...p,
                              interests: toggleMultiSelect(p.interests, o.id)
                            }))
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-ink">职业</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preset.occupations.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          className={chipBtn(persona.occupations.includes(o.id))}
                          onClick={() =>
                            setPersona((p) => ({
                              ...p,
                              occupations: toggleMultiSelect(p.occupations, o.id)
                            }))
                          }
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {persona.occupations.includes("custom") ? (
                      <input
                        type="text"
                        className={`mt-1.5 w-full ${inputCls}`}
                        placeholder="请填写职业，2～20 字"
                        maxLength={20}
                        value={persona.occupationCustom}
                        onChange={(e) =>
                          setPersona((p) => ({ ...p, occupationCustom: e.target.value }))
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </details>
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink">
                  写作人设
                  <span className="ml-1 text-[11px] font-normal text-muted">（可选）</span>
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {hasNotebookStyle ? (
                    <button
                      type="button"
                      className={`rounded-xl border p-2.5 text-left transition ${
                        useNotebookPersona
                          ? "border-brand bg-brand/10"
                          : "border-line bg-fill/50 hover:border-brand/35"
                      }`}
                      onClick={() => {
                        setUseNotebookPersona(true);
                        setPersona((p) => ({ ...p, writerVoice: null }));
                      }}
                    >
                      <span className="block text-xs font-medium text-ink">{notebookStyleCardTitle}</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted line-clamp-2">
                        {notebookStyleCardHint || "已提炼的写作口吻与特色"}
                      </span>
                      {styleChipsPreview.length > 0 ? (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {styleChipsPreview.map((c) => (
                            <span
                              key={c}
                              className="rounded border border-line/70 bg-canvas/80 px-1.5 py-0.5 text-[9px] font-medium text-ink"
                            >
                              {c}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  ) : null}
                  {preset.writerVoices.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`rounded-xl border p-2.5 text-left transition ${
                        !useNotebookPersona && persona.writerVoice === o.id
                          ? "border-brand bg-brand/10"
                          : "border-line bg-fill/50 hover:border-brand/35"
                      }`}
                      onClick={() => {
                        setUseNotebookPersona(false);
                        setPersona((p) => ({
                          ...p,
                          writerVoice: p.writerVoice === o.id ? null : o.id
                        }));
                      }}
                    >
                      <span className="block text-xs font-medium text-ink">{o.label}</span>
                      <span className="mt-0.5 block text-[10px] text-muted">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink">字数</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SOCIAL_PUBLISH_CHARS_PRESETS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={chipBtn(quick.targetCharsPreset === o.id)}
                        onClick={() => {
                          if (o.id === "custom") {
                            setQuick((q) => ({ ...q, targetCharsPreset: "custom" }));
                            return;
                          }
                          setQuick((q) => ({
                            ...q,
                            targetCharsPreset: o.id,
                            targetChars: o.chars
                          }));
                          setTargetCharsInput(String(o.chars));
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {quick.targetCharsPreset === "custom" ? (
                    <label className="mt-2 block text-[11px] text-ink">
                      自定义字数
                      <input
                        type="number"
                        min={SOCIAL_TARGET_CHARS_MIN}
                        max={SOCIAL_TARGET_CHARS_MAX}
                        className={`mt-1 w-full ${inputCls}`}
                        value={targetCharsInput}
                        onChange={(e) => setTargetCharsInput(e.target.value)}
                        onBlur={commitTargetCharsInput}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTargetCharsInput();
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <p className="mt-1.5 text-[10px] text-muted">当前约 {quick.targetChars} 字</p>
                  )}
                </div>
                <label className="block text-xs font-medium text-ink">
                  其他要求
                  <textarea
                    className={`mt-1.5 min-h-[72px] w-full resize-y ${inputCls}`}
                    value={persona.otherRequirements}
                    onChange={(e) =>
                      setPersona((p) => ({ ...p, otherRequirements: e.target.value }))
                    }
                    placeholder="例如：突出对比实验、不要提价格、语气更犀利…"
                    maxLength={300}
                  />
                </label>
                <p className="text-[10px] text-muted">
                  与「生成文章」相同：仅依据左侧勾选的参考资料（RAG 检索合并）生成，不包含对话回答。
                </p>
            </>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => setStep("platform")}
              >
                上一步
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-45"
                disabled={!personaValid || !canGenerate}
                onClick={() => void runGenerate()}
              >
                开始生成
              </button>
            </div>
          </div>
        ) : null}

        {step === "generating" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="text-sm text-ink">正在按 {platformLabel(platform)} 版式改写…</p>
            <p className="text-[11px] text-muted">
              {platform === "xiaohongshu"
                ? "结构化生成后将在后台自动合规优化"
                : "通常 20–40 秒"}
            </p>
          </div>
        ) : null}

        {step === "result" && draft ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-medium text-success-ink">✓ {platformLabel(platform)} 稿已就绪</p>
            {"compliance" in draft && draft.compliance ? (
              <p className="text-[11px] text-muted">{draft.compliance.userMessage}</p>
            ) : null}
            <div className="max-h-48 overflow-y-auto rounded-xl border border-line bg-fill/30 p-3 text-xs leading-relaxed text-ink">
              <p className="font-semibold">
                {draft.titles[draft.selectedTitleIndex] || draft.titles[0]}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{draft.body.slice(0, 600)}</p>
              {draft.body.length > 600 ? <p className="mt-1 text-muted">…</p> : null}
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground"
              onClick={() => void copyPublishPack()}
            >
              <IconClipboard width={18} height={18} />
              复制发布包
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => setShowStudio(true)}
              >
                精细编辑与预览
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => {
                  setStep("options");
                  setDraft(null);
                }}
              >
                重新生成
              </button>
            </div>
            {showGuide || copyToast ? (
              <div className="rounded-lg border border-brand/25 bg-brand/5 px-2.5 py-2 text-[11px] text-ink">
                {copyToast ? <p className="font-medium">{copyToast}</p> : null}
                <ol className="mt-1 list-decimal pl-4 text-muted">
                  {copyGuideLines(platform).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            <button type="button" className="w-full text-center text-xs text-muted hover:text-ink" onClick={onClose}>
              关闭
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
