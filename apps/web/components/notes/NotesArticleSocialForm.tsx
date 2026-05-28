"use client";

import { useEffect, useMemo, useState } from "react";
import { IconChevronLeft } from "../icons";
import {
  defaultAdvancedOptions,
  defaultPersonaOptions,
  defaultQuickOptions,
  isPersonaValid,
  platformLabel,
  publishPresetBundle,
  SOCIAL_PUBLISH_CHARS_PRESETS,
  toggleMultiSelect,
  toggleSocialGender,
  toggleSocialPersonaMulti,
  SOCIAL_TARGET_CHARS_MAX,
  SOCIAL_TARGET_CHARS_MIN,
  charsFromPreset,
  clampTargetChars
} from "../../lib/socialPublishPresets";
import type {
  SocialPublishAdvancedOptions,
  SocialPublishPersonaOptions,
  SocialPublishPlatform,
  SocialPublishQuickOptions
} from "../../lib/socialPublishTypes";

const inputCls =
  "rounded-lg border border-line bg-fill p-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

type Props = {
  platform: SocialPublishPlatform;
  notebookStylePrompt?: string;
  notebookStyleChips?: string[];
  notebookStyleName?: string;
  busy?: boolean;
  onBack: () => void;
  onSubmit: (payload: {
    platform: SocialPublishPlatform;
    quick: SocialPublishQuickOptions;
    advanced: SocialPublishAdvancedOptions;
    persona: SocialPublishPersonaOptions;
    useNotebookPersona: boolean;
  }) => void;
};

export function NotesArticleSocialForm({
  platform,
  notebookStylePrompt = "",
  notebookStyleChips = [],
  notebookStyleName = "",
  busy = false,
  onBack,
  onSubmit
}: Props) {
  const [quick, setQuick] = useState<SocialPublishQuickOptions>(() => defaultQuickOptions(platform));
  const [advanced, setAdvanced] = useState<SocialPublishAdvancedOptions>(() =>
    defaultAdvancedOptions(platform)
  );
  const [persona, setPersona] = useState<SocialPublishPersonaOptions>(() =>
    defaultPersonaOptions(platform)
  );
  const [targetCharsInput, setTargetCharsInput] = useState(String(defaultQuickOptions(platform).targetChars));
  const [useNotebookPersona, setUseNotebookPersona] = useState(Boolean(notebookStylePrompt.trim()));

  const preset = useMemo(() => publishPresetBundle(platform), [platform]);
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

  useEffect(() => {
    const q = defaultQuickOptions(platform);
    setQuick(q);
    setAdvanced(defaultAdvancedOptions(platform));
    setPersona(defaultPersonaOptions(platform));
    setTargetCharsInput(String(q.targetChars));
    setUseNotebookPersona(Boolean(notebookStylePrompt.trim()));
  }, [platform, notebookStylePrompt]);

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

  function chipBtn(active: boolean) {
    return `rounded-full border px-2.5 py-1 text-xs ${
      active ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"
    }`;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
        onClick={onBack}
        disabled={busy}
      >
        <IconChevronLeft width={14} height={14} />
        重选体裁
      </button>
      <p className="text-xs text-muted">
        {platformLabel(platform)} · 提交后进入作品页查看进度与全文（与生成文章相同）
      </p>
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
                onChange={(e) => setPersona((p) => ({ ...p, occupationCustom: e.target.value }))}
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
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-2 text-sm"
          disabled={busy}
          onClick={onBack}
        >
          取消
        </button>
        <button
          type="button"
          className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-foreground disabled:opacity-45"
          disabled={!personaValid || busy}
          onClick={() =>
            onSubmit({
              platform,
              quick: quickForPayload,
              advanced,
              persona,
              useNotebookPersona
            })
          }
        >
          {busy ? "提交中…" : "开始生成"}
        </button>
      </div>
    </div>
  );
}
