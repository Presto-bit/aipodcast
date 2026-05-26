"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";
import {
  emptyResume,
  resumeCardTitle,
  resumeToStorage,
  tryParseResume,
  type ResumeData,
  type ResumeEducationEntry,
  type ResumeProjectEntry,
  type ResumeWorkEntry,
  RESUME_TEMPLATE_ID
} from "./resumeTypes";

type Props = {
  open: boolean;
  initialBody?: string;
  initialTitle?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (payload: { title: string; body: string; experienceTemplateId: string }) => void;
  onCancel: () => void;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted">{children}</span>;
}

export default function AuthorIpResumeModal({
  open,
  initialBody,
  initialTitle,
  busy,
  error,
  onSubmit,
  onCancel
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ResumeData>(emptyResume());

  useEffect(() => {
    if (!open) return;
    const parsed = tryParseResume(initialBody || "");
    setData(parsed || emptyResume());
  }, [open, initialBody]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open || typeof document === "undefined") return null;

  const updateWork = (idx: number, patch: Partial<ResumeWorkEntry>) => {
    setData((d) => ({
      ...d,
      work: d.work.map((w, i) => (i === idx ? { ...w, ...patch } : w))
    }));
  };

  const updateEdu = (idx: number, patch: Partial<ResumeEducationEntry>) => {
    setData((d) => ({
      ...d,
      education: d.education.map((e, i) => (i === idx ? { ...e, ...patch } : e))
    }));
  };

  const updateProject = (idx: number, patch: Partial<ResumeProjectEntry>) => {
    setData((d) => ({
      ...d,
      projects: d.projects.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    }));
  };

  const handleSubmit = () => {
    const hasWork = data.work.some((w) => w.company.trim() || w.role.trim());
    if (!data.headline.trim() && !hasWork && !data.summary.trim()) {
      return;
    }
    const title = initialTitle?.trim() || resumeCardTitle(data);
    onSubmit({
      title,
      body: resumeToStorage(data),
      experienceTemplateId: RESUME_TEMPLATE_ID
    });
  };

  const inputClass = "mt-1 w-full rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm";

  return createPortal(
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(90vh,800px)] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">填写简历经历</h2>
          <p className="mt-1 text-xs text-muted">按模块填写，将用于写作时引用你的背景</p>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <FieldLabel>职业标题 / 一句话</FieldLabel>
            <input
              className={inputClass}
              placeholder="例如：资深产品经理"
              value={data.headline}
              onChange={(e) => setData((d) => ({ ...d, headline: e.target.value }))}
            />
            <FieldLabel>个人简介（选填）</FieldLabel>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="3～5 行概括你的方向与优势"
              value={data.summary}
              onChange={(e) => setData((d) => ({ ...d, summary: e.target.value }))}
            />
          </section>

          <section>
            <div className="flex items-center justify-between">
              <FieldLabel>工作经历</FieldLabel>
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() =>
                  setData((d) => ({
                    ...d,
                    work: [...d.work, { company: "", role: "", period: "", highlights: "" }]
                  }))
                }
              >
                + 一段
              </button>
            </div>
            {data.work.map((w, i) => (
              <div key={i} className="mt-2 rounded-lg border border-line/80 bg-fill/20 p-3">
                <input
                  className={inputClass}
                  placeholder="公司 / 组织"
                  value={w.company}
                  onChange={(e) => updateWork(i, { company: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="职位"
                  value={w.role}
                  onChange={(e) => updateWork(i, { role: e.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="时间（如 2020.03 – 至今）"
                  value={w.period}
                  onChange={(e) => updateWork(i, { period: e.target.value })}
                />
                <textarea
                  className={inputClass}
                  rows={3}
                  placeholder="主要成果与职责（条目或短段）"
                  value={w.highlights}
                  onChange={(e) => updateWork(i, { highlights: e.target.value })}
                />
                {data.work.length > 1 ? (
                  <button
                    type="button"
                    className="mt-1 text-xs text-danger-ink hover:underline"
                    onClick={() => setData((d) => ({ ...d, work: d.work.filter((_, j) => j !== i) }))}
                  >
                    删除本段
                  </button>
                ) : null}
              </div>
            ))}
          </section>

          <section>
            <div className="flex items-center justify-between">
              <FieldLabel>教育背景</FieldLabel>
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() =>
                  setData((d) => ({
                    ...d,
                    education: [...d.education, { school: "", degree: "", period: "" }]
                  }))
                }
              >
                + 一条
              </button>
            </div>
            {data.education.map((e, i) => (
              <div key={i} className="mt-2 grid gap-1 rounded-lg border border-line/80 bg-fill/20 p-3">
                <input
                  className={inputClass}
                  placeholder="学校"
                  value={e.school}
                  onChange={(ev) => updateEdu(i, { school: ev.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="学历 / 专业"
                  value={e.degree}
                  onChange={(ev) => updateEdu(i, { degree: ev.target.value })}
                />
                <input
                  className={inputClass}
                  placeholder="时间"
                  value={e.period}
                  onChange={(ev) => updateEdu(i, { period: ev.target.value })}
                />
              </div>
            ))}
          </section>

          <section>
            <div className="flex items-center justify-between">
              <FieldLabel>项目经历（选填）</FieldLabel>
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() =>
                  setData((d) => ({
                    ...d,
                    projects: [...d.projects, { name: "", role: "", description: "" }]
                  }))
                }
              >
                + 一项
              </button>
            </div>
            {data.projects.length === 0 ? (
              <p className="mt-1 text-xs text-muted">无项目可跳过</p>
            ) : (
              data.projects.map((p, i) => (
                <div key={i} className="mt-2 rounded-lg border border-line/80 bg-fill/20 p-3">
                  <input
                    className={inputClass}
                    placeholder="项目名称"
                    value={p.name}
                    onChange={(ev) => updateProject(i, { name: ev.target.value })}
                  />
                  <input
                    className={inputClass}
                    placeholder="你的角色"
                    value={p.role}
                    onChange={(ev) => updateProject(i, { role: ev.target.value })}
                  />
                  <textarea
                    className={inputClass}
                    rows={2}
                    placeholder="项目说明"
                    value={p.description}
                    onChange={(ev) => updateProject(i, { description: ev.target.value })}
                  />
                </div>
              ))
            )}
          </section>

          <section>
            <FieldLabel>技能标签（选填，逗号分隔）</FieldLabel>
            <input
              className={inputClass}
              placeholder="产品规划, 数据分析, 用户研究"
              value={data.skills}
              onChange={(e) => setData((d) => ({ ...d, skills: e.target.value }))}
            />
          </section>
        </div>
        {error ? <p className="px-5 text-sm text-danger-ink">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" disabled={busy} onClick={handleSubmit}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
