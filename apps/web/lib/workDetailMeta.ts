import type { JobRecord } from "./types";

/** 「来源」弹层是否可打开（是否有可展示的结构化素材） */
export function jobHasWorkSourceDetail(job: JobRecord | null): boolean {
  if (!job) return false;
  const payload = (job.payload || {}) as Record<string, unknown>;
  const result = (job.result || {}) as Record<string, unknown>;
  const titlesRaw = result.notes_source_titles;
  let titleCount = 0;
  if (Array.isArray(titlesRaw)) {
    for (const x of titlesRaw) {
      if (String(x || "").trim()) titleCount += 1;
    }
  }
  const sn = payload.selected_note_ids;
  const noteCount = Array.isArray(sn) ? sn.filter((x) => typeof x === "string" && String(x).trim()).length : 0;
  const url = String(payload.url || "").trim();
  const nb = String(result.notes_source_notebook || payload.notes_notebook || "").trim();
  const program = String(payload.program_name || "").trim();
  return Boolean(
    titleCount > 0 ||
      noteCount > 0 ||
      url ||
      nb ||
      program ||
      String(payload.text || "").trim() ||
      String(payload.core_question || "").trim() ||
      String(payload.script_constraints || "").trim() ||
      String(payload.reference_extra || "").trim()
  );
}

export type WorkSourceModalModel = {
  /** 顶部说明：写作参考、大纲与低稿 */
  outlineNotice: string;
  programName: string;
  coreQuestion: string;
  scriptConstraints: string;
  payloadTextPreview: string;
  url: string;
  referenceExtra: string;
  noteTitles: string[];
  notebook: string;
  referenceTextsPreview: string[];
};

export function buildWorkSourceModalModel(job: JobRecord | null): WorkSourceModalModel {
  const empty: WorkSourceModalModel = {
    outlineNotice:
      "这里汇总的是**撰稿前可用的素材与约束**：例如你勾选的笔记、粘贴的链接、附加说明等。模型会在此基础上生成「写作大纲」与口播初稿（低稿）；这些中间产物通常已融入最终口播稿，不一定单独保存在任务里。\n\n" +
      "下方各区块对应任务创建时写入的字段；若某次生成主要依赖长正文而非结构化字段，请以「任务输入正文」与引用笔记为准。",
    programName: "",
    coreQuestion: "",
    scriptConstraints: "",
    payloadTextPreview: "",
    url: "",
    referenceExtra: "",
    noteTitles: [],
    notebook: "",
    referenceTextsPreview: []
  };
  if (!job) return empty;
  const payload = (job.payload || {}) as Record<string, unknown>;
  const result = (job.result || {}) as Record<string, unknown>;
  const titlesRaw = result.notes_source_titles;
  const noteTitles: string[] = [];
  if (Array.isArray(titlesRaw)) {
    for (const x of titlesRaw) {
      const t = String(x || "").trim();
      if (t) noteTitles.push(t);
    }
  }
  const rt = payload.reference_texts;
  const referenceTextsPreview: string[] = [];
  if (Array.isArray(rt)) {
    for (const x of rt.slice(0, 6)) {
      const s = String(x || "").trim().replace(/\s+/g, " ");
      if (s) referenceTextsPreview.push(s.length > 400 ? `${s.slice(0, 400)}…` : s);
    }
  }
  const pt = String(payload.text || "").trim().replace(/\s+/g, " ");
  return {
    ...empty,
    programName: String(payload.program_name || "").trim(),
    coreQuestion: String(payload.core_question || "").trim(),
    scriptConstraints: String(payload.script_constraints || "").trim(),
    payloadTextPreview: pt.length > 2000 ? `${pt.slice(0, 2000)}…` : pt,
    url: String(payload.url || "").trim(),
    referenceExtra: String(payload.reference_extra || "").trim(),
    noteTitles,
    notebook: String(result.notes_source_notebook || payload.notes_notebook || "").trim(),
    referenceTextsPreview
  };
}
