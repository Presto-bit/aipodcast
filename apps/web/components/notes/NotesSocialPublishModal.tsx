"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconChevronLeft, IconX } from "../icons";
import {
  clearActiveGenerationJob,
  readActiveGenerationJob,
  setActiveGenerationJob
} from "../../lib/activeJobSession";
import { apiErrorMessage, softenBareErrorLineForUi } from "../../lib/apiError";
import { createJob } from "../../lib/api";
import { NOTES_PODCAST_PROJECT_NAME } from "../../lib/notesProject";
import { buildSocialPublishReferenceBody } from "../../lib/socialPublishReference";
import {
  buildOptionsPayload,
  clampTargetChars,
  defaultAdvancedOptions,
  defaultPersonaOptions,
  defaultQuickOptions,
  isPersonaValid,
  publishPresetBundle,
  SOCIAL_PUBLISH_CHARS_PRESETS,
  toggleMultiSelect,
  toggleSocialGender,
  toggleSocialPersonaMulti,
  SOCIAL_TARGET_CHARS_MAX,
  SOCIAL_TARGET_CHARS_MIN,
  charsFromPreset
} from "../../lib/socialPublishPresets";
import { loadSocialPublishPrefs, saveSocialPublishPrefs } from "../../lib/socialPublishStorage";
import type {
  SocialPublishAdvancedOptions,
  SocialPublishPersonaOptions,
  SocialPublishPlatform,
  SocialPublishQuickOptions,
  SocialPublishWizardStep
} from "../../lib/socialPublishTypes";

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
  createdByPhone?: string;
  /** 创建任务后跳转作品详情时的 returnTo 查询参数 */
  workDetailReturnTo?: string;
  /** 任务已创建（写入最近作品、刷新列表） */
  onJobCreated?: (jobId: string) => void;
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
  authHeaders: _authHeadersUnused,
  notebookStylePrompt = "",
  notebookStyleChips = [],
  notebookStyleName = "",
  createdByPhone = "",
  workDetailReturnTo = "/notes",
  onJobCreated
}: Props) {
  const router = useRouter();
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const notebookStyleCardTitle = ((notebookStyleName || "本笔记本风格").trim() || "本笔记本风格").slice(
    0,
    16
  );
  const personaCardHintCls =
    "mt-0.5 block min-h-[2.5rem] text-[10px] leading-snug text-muted line-clamp-2";
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
    setError("");
    setBusy(false);
    setUseNotebookPersona(Boolean(notebookStylePrompt.trim()));
  }, [open, noteIds, notebookStylePrompt]);

  useEffect(() => {
    if (!open) return;
    const jid = readActiveGenerationJob("social_publish");
    if (!jid) return;
    onClose();
    const returnTo = workDetailReturnTo.trim() || "/notes";
    router.push(
      `/works/${encodeURIComponent(jid)}?returnTo=${encodeURIComponent(returnTo)}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅打开时恢复未完成任务
  }, [open]);

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
    try {
      let personaForPayload =
        useNotebookPersona && notebookStylePrompt.trim()
          ? {
              ...persona,
              writerVoice: null,
              otherRequirements: [notebookStylePrompt.trim(), persona.otherRequirements.trim()]
                .filter(Boolean)
                .join("\n\n")
            }
          : { ...persona };
      if (!personaForPayload.genders.length) {
        personaForPayload = { ...personaForPayload, genders: ["any"] };
      }
      const options = buildOptionsPayload(quickForPayload, advanced, personaForPayload, platform);
      const refBody = buildSocialPublishReferenceBody({
        selectedNoteIds: noteIds,
        selectedNoteTitles,
        notesSourceOwnerUserId
      });
      const job = await createJob({
        project_name: NOTES_PODCAST_PROJECT_NAME,
        job_type: "social_publish_draft",
        queue_name: "ai",
        created_by: createdByPhone || undefined,
        payload: {
          platform,
          options,
          source_type: "notes_rag",
          notes_notebook: notebook.trim(),
          ...refBody
        }
      });
      const jobId = String(job.id || "").trim();
      if (!jobId) throw new Error("创建发布稿任务失败");
      setActiveGenerationJob("social_publish", jobId);
      saveSocialPublishPrefs(platform, quickForPayload);
      onJobCreated?.(jobId);
      onClose();
      const returnTo = workDetailReturnTo.trim() || "/notes";
      router.push(
        `/works/${encodeURIComponent(jobId)}?returnTo=${encodeURIComponent(returnTo)}`
      );
    } catch (err) {
      clearActiveGenerationJob("social_publish");
      const raw = err instanceof Error ? err.message : String(err);
      setError(softenBareErrorLineForUi(raw) || apiErrorMessage({}, "生成发布稿失败"));
    } finally {
      setBusy(false);
    }
  }, [
    canGenerate,
    noteIds,
    selectedNoteTitles,
    notesSourceOwnerUserId,
    quickForPayload,
    advanced,
    platform,
    persona,
    useNotebookPersona,
    notebookStylePrompt,
    createdByPhone,
    notebook,
    onJobCreated,
    onClose,
    router,
    workDetailReturnTo
  ]);

  function chipBtn(active: boolean) {
    return `rounded-full border px-2.5 py-1 text-xs ${
      active ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"
    }`;
  }

  if (!open) return null;

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
            <p className="mt-0.5 text-[11px] text-muted">
              提交后进入作品详情页查看进度与完整发布稿，需自行在平台 App 内粘贴发布
            </p>
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
                              genders: toggleSocialGender(p.genders, o.id as typeof p.genders[0])
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
                              ageRanges: toggleSocialPersonaMulti(
                                p.ageRanges,
                                o.id as typeof p.ageRanges[0],
                                "all_ages",
                                ["25_34"]
                              )
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
                              regions: toggleSocialPersonaMulti(
                                p.regions,
                                o.id as typeof p.regions[0],
                                "any",
                                ["tier1"]
                              )
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
                              occupations: toggleSocialPersonaMulti(
                                p.occupations,
                                o.id as typeof p.occupations[0],
                                undefined,
                                ["office_worker"]
                              )
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
                      className={`flex min-h-[5.25rem] flex-col rounded-xl border p-2.5 text-left transition ${
                        useNotebookPersona
                          ? "border-brand bg-brand/10"
                          : "border-line bg-fill/50 hover:border-brand/35"
                      }`}
                      onClick={() => {
                        setUseNotebookPersona(true);
                        setPersona((p) => ({ ...p, writerVoice: null }));
                      }}
                    >
                      <span className="block text-xs font-medium text-ink line-clamp-1">
                        {notebookStyleCardTitle}
                      </span>
                      <span className={personaCardHintCls}>
                        {notebookStyleCardHint || "已提炼的写作口吻与特色"}
                      </span>
                    </button>
                  ) : null}
                  {preset.writerVoices.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`flex min-h-[5.25rem] flex-col rounded-xl border p-2.5 text-left transition ${
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
                      <span className="block text-xs font-medium text-ink line-clamp-1">{o.label}</span>
                      <span className={personaCardHintCls}>{o.hint}</span>
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
                  onChange={(e) => setPersona((p) => ({ ...p, otherRequirements: e.target.value }))}
                  placeholder="例如：突出对比实验、不要提价格、语气更犀利…"
                  maxLength={300}
                />
              </label>
              <p className="text-[10px] text-muted">
                与「生成文章」相同：提交后跳转作品详情页查看进度，生成完成后在同一页查看标题、配图建议与正文。
              </p>
            </>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-2 text-sm"
                onClick={() => setStep("platform")}
                disabled={busy}
              >
                上一步
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-45"
                disabled={!personaValid || !canGenerate || busy}
                onClick={() => void runGenerate()}
              >
                {busy ? "提交中…" : "开始生成"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
