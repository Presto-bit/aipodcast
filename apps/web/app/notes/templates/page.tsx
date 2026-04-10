"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  BUILTIN_CREATIVE_PRESETS,
  creativeBundleFromPreset,
  type CreativeBundle
} from "../../../lib/creativeTemplates";
import { addUserTemplate, listUserTemplates, removeUserTemplate, type UserTemplate } from "../../../lib/userTemplates";

function CollapsibleCreativeSection({
  open,
  onToggle,
  title,
  subtitle,
  children
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-fill/40 shadow-soft">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-fill/80"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-[11px] text-muted">{subtitle}</span>
        </span>
      </button>
      {open ? <div className="space-y-4 border-t border-line px-4 py-4">{children}</div> : null}
    </div>
  );
}

function CreativeBundleDetailDl({ bundle, textPrefix }: { bundle: CreativeBundle; textPrefix?: string }) {
  const prefix = textPrefix?.trim();
  return (
    <dl className="mt-3 space-y-2 text-xs">
      <div>
        <dt className="font-medium text-muted">脚本风格</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-ink">{bundle.scriptStyle}</dd>
      </div>
      <div>
        <dt className="font-medium text-muted">Speaker1 人设</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-ink">{bundle.speaker1Persona}</dd>
      </div>
      <div>
        <dt className="font-medium text-muted">Speaker2 人设</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-ink">{bundle.speaker2Persona}</dd>
      </div>
      <div>
        <dt className="font-medium text-muted">脚本细节约束</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-ink">{bundle.scriptConstraints}</dd>
      </div>
      {prefix ? (
        <div>
          <dt className="font-medium text-muted">主素材风格提示（textPrefix）</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-ink">{prefix}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default function UserTemplatesPage() {
  const [items, setItems] = useState<UserTemplate[]>([]);
  const [creativeScriptStyle, setCreativeScriptStyle] = useState("");
  const [creativeSpeaker1, setCreativeSpeaker1] = useState("");
  const [creativeSpeaker2, setCreativeSpeaker2] = useState("");
  const [creativeConstraints, setCreativeConstraints] = useState("");
  const [msg, setMsg] = useState("");
  /** 默认 / 自定义模板区：外层折叠卡片，默认收起 */
  const [builtinCardOpen, setBuiltinCardOpen] = useState(false);
  const [customCardOpen, setCustomCardOpen] = useState(false);

  const refresh = useCallback(() => {
    setItems(
      listUserTemplates().filter((t) => (t.category || "").trim() === "加入创意")
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const id = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const hasCreative =
      Boolean(creativeScriptStyle.trim()) ||
      Boolean(creativeSpeaker1.trim()) ||
      Boolean(creativeSpeaker2.trim()) ||
      Boolean(creativeConstraints.trim());
    if (!hasCreative) {
      setMsg("请至少填写一项加入创意");
      return;
    }
    const savedAt = new Date();
    const autoLabel = `加入创意 · ${savedAt.toLocaleString("zh-CN", { hour12: false })}`;
    addUserTemplate({
      id,
      label: autoLabel,
      description: "仅加入创意参数",
      category: "加入创意",
      textPrefix: "",
      ...(creativeScriptStyle.trim() ? { scriptStyle: creativeScriptStyle.trim() } : {}),
      ...(creativeSpeaker1.trim() ? { speaker1Persona: creativeSpeaker1.trim() } : {}),
      ...(creativeSpeaker2.trim() ? { speaker2Persona: creativeSpeaker2.trim() } : {}),
      ...(creativeConstraints.trim() ? { scriptConstraints: creativeConstraints.trim() } : {})
    });
    setCreativeScriptStyle("");
    setCreativeSpeaker1("");
    setCreativeSpeaker2("");
    setCreativeConstraints("");
    refresh();
    setMsg("已保存");
  }

  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl px-3 pb-10 sm:px-4">
      <h1 className="text-2xl font-semibold text-ink">加入创意</h1>

      <form className="mt-6 space-y-4" onSubmit={onAdd}>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">加入创意</h2>
          <p className="mt-1 text-[11px] text-muted">
            至少填写一项后保存为方案；在 AI 播客 / 笔记本「加入创意」下拉里可选中该自定义方案。
          </p>
          <label className="mt-3 block text-xs text-muted">
            脚本风格
            <input
              className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-1.5 text-sm"
              value={creativeScriptStyle}
              onChange={(e) => setCreativeScriptStyle(e.target.value)}
              placeholder="自行填写，例如：轻松幽默，自然流畅"
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            Speaker1 人设
            <input
              className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-1.5 text-sm"
              value={creativeSpeaker1}
              onChange={(e) => setCreativeSpeaker1(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            Speaker2 人设
            <input
              className="mt-1 w-full rounded-lg border border-line bg-fill px-2 py-1.5 text-sm"
              value={creativeSpeaker2}
              onChange={(e) => setCreativeSpeaker2(e.target.value)}
              placeholder="可选"
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            脚本细节约束
            <textarea
              className="mt-1 min-h-[72px] w-full rounded-lg border border-line bg-fill px-2 py-2 text-sm"
              value={creativeConstraints}
              onChange={(e) => setCreativeConstraints(e.target.value)}
              placeholder="可选；不设时使用播客页默认约束"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm text-brand-foreground hover:bg-brand">
            保存方案
          </button>
          {msg ? <p className="text-xs text-muted">{msg}</p> : null}
        </div>
      </form>

      <section className="mt-10">
        <CollapsibleCreativeSection
          open={builtinCardOpen}
          onToggle={() => setBuiltinCardOpen((o) => !o)}
          title="默认创意模板"
          subtitle={`系统自带共 ${BUILTIN_CREATIVE_PRESETS.length} 套，与播客页下拉里一致；展开可查看脚本风格、人设与约束原文`}
        >
          {BUILTIN_CREATIVE_PRESETS.map((preset) => {
            const bundle = creativeBundleFromPreset(preset);
            return (
              <div key={preset.id} className="rounded-xl border border-line bg-surface p-3.5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/80 pb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{preset.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{preset.description}</p>
                  </div>
                  <Link
                    href={`/podcast?applyCreative=${encodeURIComponent(`sys:${preset.id}`)}`}
                    className="shrink-0 text-xs text-brand hover:underline"
                  >
                    填入 AI 播客
                  </Link>
                </div>
                <CreativeBundleDetailDl bundle={bundle} textPrefix={preset.textPrefix} />
              </div>
            );
          })}
        </CollapsibleCreativeSection>
      </section>

      <section className="mt-8">
        <CollapsibleCreativeSection
          open={customCardOpen}
          onToggle={() => setCustomCardOpen((o) => !o)}
          title="自定义创意模板"
          subtitle={
            <>
              仅本人可见；已保存 {items.length} 条。登录后随用户偏好同步到服务器。
            </>
          }
        >
          {items.length === 0 ? (
            <p className="text-sm text-muted">暂无自定义模板，请在上方填写并保存。</p>
          ) : (
            items.map((t) => {
              const bundle = creativeBundleFromPreset(t);
              return (
                <div key={t.id} className="rounded-xl border border-line bg-surface p-3.5 shadow-soft">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/80 pb-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{t.label}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t.category} · {t.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                      <Link
                        href={`/podcast?applyCreative=${encodeURIComponent(`usr:${t.id}`)}`}
                        className="text-xs text-brand hover:underline"
                      >
                        填入 AI 播客
                      </Link>
                      <button
                        type="button"
                        className="text-xs text-danger-ink hover:underline"
                        onClick={() => {
                          if (window.confirm("删除该方案？")) {
                            removeUserTemplate(t.id);
                            refresh();
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <CreativeBundleDetailDl bundle={bundle} textPrefix={t.textPrefix} />
                </div>
              );
            })
          )}
        </CollapsibleCreativeSection>
      </section>
    </main>
  );
}
