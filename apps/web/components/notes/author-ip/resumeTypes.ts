/** 结构化经历（存入 experience_card 正文，experienceTemplateId=resume_v1） */

export type ResumeWorkEntry = {
  company: string;
  role: string;
  period: string;
  highlights: string;
};

export type ResumeEducationEntry = {
  school: string;
  degree: string;
  period: string;
};

export type ResumeProjectEntry = {
  name: string;
  role: string;
  description: string;
};

export type ResumeData = {
  resumeVersion: 1;
  headline: string;
  summary: string;
  work: ResumeWorkEntry[];
  education: ResumeEducationEntry[];
  projects: ResumeProjectEntry[];
  skills: string;
};

export const RESUME_TEMPLATE_ID = "resume_v1";

export function emptyResume(): ResumeData {
  return {
    resumeVersion: 1,
    headline: "",
    summary: "",
    work: [{ company: "", role: "", period: "", highlights: "" }],
    education: [{ school: "", degree: "", period: "" }],
    projects: [],
    skills: ""
  };
}

export function tryParseResume(body: string): ResumeData | null {
  const raw = (body || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const data = JSON.parse(raw) as ResumeData;
    if (data?.resumeVersion !== 1) return null;
    return {
      resumeVersion: 1,
      headline: String(data.headline || ""),
      summary: String(data.summary || ""),
      work: Array.isArray(data.work) ? data.work.map(normalizeWork) : [],
      education: Array.isArray(data.education) ? data.education.map(normalizeEdu) : [],
      projects: Array.isArray(data.projects) ? data.projects.map(normalizeProject) : [],
      skills: String(data.skills || "")
    };
  } catch {
    return null;
  }
}

function normalizeWork(w: ResumeWorkEntry): ResumeWorkEntry {
  return {
    company: String(w.company || ""),
    role: String(w.role || ""),
    period: String(w.period || ""),
    highlights: String(w.highlights || "")
  };
}

function normalizeEdu(e: ResumeEducationEntry): ResumeEducationEntry {
  return {
    school: String(e.school || ""),
    degree: String(e.degree || ""),
    period: String(e.period || "")
  };
}

function normalizeProject(p: ResumeProjectEntry): ResumeProjectEntry {
  return {
    name: String(p.name || ""),
    role: String(p.role || ""),
    description: String(p.description || "")
  };
}

export function resumeToStorage(data: ResumeData): string {
  return JSON.stringify(data, null, 0);
}

export function resumeToMarkdown(data: ResumeData): string {
  const lines: string[] = [];
  if (data.headline.trim()) lines.push(`# ${data.headline.trim()}`);
  if (data.summary.trim()) {
    lines.push("", "## 个人简介", data.summary.trim());
  }
  const work = data.work.filter((w) => w.company.trim() || w.role.trim());
  if (work.length) {
    lines.push("", "## 工作经历");
    for (const w of work) {
      lines.push("", `### ${w.company.trim() || "—"} · ${w.role.trim() || "—"}`, w.period.trim() || "");
      if (w.highlights.trim()) lines.push(w.highlights.trim());
    }
  }
  const edu = data.education.filter((e) => e.school.trim());
  if (edu.length) {
    lines.push("", "## 教育背景");
    for (const e of edu) {
      lines.push(`- ${e.school.trim()} · ${e.degree.trim()} (${e.period.trim()})`);
    }
  }
  const proj = data.projects.filter((p) => p.name.trim());
  if (proj.length) {
    lines.push("", "## 项目经历");
    for (const p of proj) {
      lines.push("", `### ${p.name.trim()}${p.role.trim() ? ` · ${p.role.trim()}` : ""}`);
      if (p.description.trim()) lines.push(p.description.trim());
    }
  }
  if (data.skills.trim()) {
    lines.push("", "## 技能", data.skills.trim());
  }
  return lines.join("\n").trim();
}

export function resumeCardTitle(data: ResumeData): string {
  const h = data.headline.trim();
  if (h) return h.length > 28 ? `${h.slice(0, 28)}…` : h;
  const first = data.work.find((w) => w.company.trim() || w.role.trim());
  if (first) {
    const t = `${first.company} · ${first.role}`.trim();
    return t.startsWith("·") ? "我的经历" : t;
  }
  return "我的经历";
}

export function resumeCardSubtitle(data: ResumeData): string {
  const n = data.work.filter((w) => w.company.trim() || w.role.trim()).length;
  const parts = [`${n} 段工作`];
  if (data.education.some((e) => e.school.trim())) parts.push("含教育");
  if (data.projects.some((p) => p.name.trim())) parts.push("含项目");
  return `经历 · ${parts.join(" · ")}`;
}
