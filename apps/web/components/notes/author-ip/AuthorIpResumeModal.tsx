"use client";

import { useEffect, useState } from "react";
import { Button } from "../../ui/Button";
import AuthorIpCompactModal from "./AuthorIpCompactModal";
import { EDU_PERIOD_OPTIONS, periodSelectClassName, WORK_PERIOD_OPTIONS } from "./experiencePeriodOptions";
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

function PeriodSelect({
  value,
  options,
  onChange
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const inList = options.some((o) => o.value === value);
  return (
    <select
      className={periodSelectClassName()}
      value={inList ? value : "__custom__"}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "__custom__" ? "" : v);
      }}
    >
      {options.map((o) => (
        <option key={o.value || "empty"} value={o.value || "__custom__"}>
          {o.label}
        </option>
      ))}
      {!inList && value ? <option value="__custom__">{value}</option> : null}
    </select>
  );
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
  const [data, setData] = useState<ResumeData>(emptyResume());

  useEffect(() => {
    if (!open) return;
    const parsed = tryParseResume(initialBody || "");
    setData(parsed || emptyResume());
  }, [open, initialBody]);

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
    if (!data.headline.trim() && !hasWork && !data.summary.trim()) return;
    const title = initialTitle?.trim() || resumeCardTitle(data);
    onSubmit({
      title,
      body: resumeToStorage(data),
      experienceTemplateId: RESUME_TEMPLATE_ID
    });
  };

  const inputClass = "mt-1 w-full rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm";

  return (
    <AuthorIpCompactModal
      open={open}
      title="填写经历"
      description="结构化填写背景，用于写作引用与风格解析"
      busy={busy}
      onClose={onCancel}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-xs text-danger-ink">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={onCancel}>
              取消
            </Button>
            <Button type="button" className="px-2.5 py-1.5 text-xs" disabled={busy} onClick={handleSubmit}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
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
              <FieldLabel>时间段</FieldLabel>
              <PeriodSelect
                value={w.period}
                options={WORK_PERIOD_OPTIONS}
                onChange={(v) => updateWork(i, { period: v })}
              />
              <textarea
                className={inputClass}
                rows={3}
                placeholder="主要成果与职责"
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
            <div key={i} className="mt-2 rounded-lg border border-line/80 bg-fill/20 p-3">
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
              <FieldLabel>时间段</FieldLabel>
              <PeriodSelect
                value={e.period}
                options={EDU_PERIOD_OPTIONS}
                onChange={(v) => updateEdu(i, { period: v })}
              />
            </div>
          ))}
        </section>

        <section>
          <FieldLabel>技能标签（选填，逗号分隔）</FieldLabel>
          <input
            className={inputClass}
            placeholder="产品规划, 数据分析"
            value={data.skills}
            onChange={(e) => setData((d) => ({ ...d, skills: e.target.value }))}
          />
        </section>
      </div>
    </AuthorIpCompactModal>
  );
}
