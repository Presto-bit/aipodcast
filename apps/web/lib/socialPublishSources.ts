import { buildNotesAskAnswerBody } from "./notesAskAnswerNormalize";
import { resolveJobScriptBodyText } from "./jobScriptText";
import type { WorkItem } from "./worksTypes";
import type { SocialPublishSourceCandidate, SocialPublishSourceType } from "./socialPublishTypes";

const PODCAST_TYPES = new Set(["podcast_generate", "podcast", "podcast_short_video"]);
const ARTICLE_TYPES = new Set(["script_draft"]);

function workMatchesNotebook(w: WorkItem, notebook: string): boolean {
  const nb = String(w.notesSourceNotebook || "").trim();
  return !notebook || nb === notebook;
}

function succeededWork(w: WorkItem): boolean {
  const st = String(w.status || "").toLowerCase();
  return !st || st === "succeeded";
}

export function lastAssistantAnswerText(
  messages: Array<{ role: string; content: string; supplementContent?: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const body = buildNotesAskAnswerBody(m.content, m.supplementContent);
    if (body.trim().length >= 40) return body.trim();
  }
  return "";
}

export function buildSocialPublishSourceCandidates(params: {
  notebook: string;
  works: WorkItem[];
  askMessages: Array<{ role: string; content: string; supplementContent?: string }>;
}): SocialPublishSourceCandidate[] {
  const out: SocialPublishSourceCandidate[] = [];
  const ask = lastAssistantAnswerText(params.askMessages);
  if (ask.length >= 40) {
    out.push({
      key: "ask_answer",
      type: "ask_answer",
      label: "刚才的对话回答",
      materialPreview: ask.slice(0, 120) + (ask.length > 120 ? "…" : ""),
      materialText: ask,
      recommended: true
    });
  }

  const nb = params.notebook.trim();
  const sorted = [...params.works]
    .filter((w) => succeededWork(w) && workMatchesNotebook(w, nb))
    .sort((a, b) => {
      const ta = new Date(String(a.createdAt || 0)).getTime();
      const tb = new Date(String(b.createdAt || 0)).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  for (const w of sorted) {
    const t = String(w.type || "");
    const script = String(w.scriptText || "").trim();
    if (script.length < 40) continue;
    const title = String(w.title || w.workProgramName || "作品").trim();
    const date = w.createdAt ? new Date(String(w.createdAt)).toLocaleDateString("zh-CN") : "";
    if (ARTICLE_TYPES.has(t)) {
      out.push({
        key: `article_job:${w.id}`,
        type: "article_job",
        label: `文章作品 · ${title}${date ? `（${date}）` : ""}`,
        materialPreview: script.slice(0, 120) + (script.length > 120 ? "…" : ""),
        materialText: script,
        jobId: String(w.id || ""),
        recommended: !ask && out.every((x) => x.type !== "article_job")
      });
    } else if (PODCAST_TYPES.has(t)) {
      out.push({
        key: `podcast_job:${w.id}`,
        type: "podcast_job",
        label: `播客文稿 · ${title}${date ? `（${date}）` : ""}`,
        materialPreview: script.slice(0, 120) + (script.length > 120 ? "…" : ""),
        materialText: script,
        jobId: String(w.id || ""),
        recommended: !ask && !out.some((x) => x.type === "article_job")
      });
    }
  }

  if (!out.some((x) => x.recommended) && out.length) {
    out[0].recommended = true;
  }

  return out;
}

export async function resolveSourceMaterial(params: {
  source: SocialPublishSourceCandidate;
  authHeaders: Record<string, string>;
  noteIds: string[];
}): Promise<string> {
  if (params.source.type !== "notes_only") {
    if (params.source.materialText.trim().length >= 40) return params.source.materialText.trim();
    if (params.source.jobId) {
      const res = await fetch(`/api/jobs/${encodeURIComponent(params.source.jobId)}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { ...params.authHeaders }
      });
      const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok) {
        const text = await resolveJobScriptBodyText(params.source.jobId, row, params.authHeaders);
        if (text.trim().length >= 40) return text.trim();
      }
    }
    throw new Error("素材正文过短，请换一项或先完成对话/作品生成");
  }

  const chunks: string[] = [];
  for (const nid of params.noteIds.slice(0, 5)) {
    const res = await fetch(
      `/api/notes/${encodeURIComponent(nid)}/preview_text?max_chars=4000`,
      { credentials: "same-origin", cache: "no-store", headers: { ...params.authHeaders } }
    );
    const data = (await res.json().catch(() => ({}))) as { text?: string; filtered_text?: string };
    const t = String(data.filtered_text || data.text || "").trim();
    if (t) chunks.push(t);
  }
  const merged = chunks.join("\n\n").trim();
  if (merged.length < 40) {
    throw new Error("勾选资料过短，请先向资料提问或生成文章/播客后再发布");
  }
  return merged.slice(0, 48_000);
}

export function notesOnlySourceCandidate(noteCount: number): SocialPublishSourceCandidate {
  return {
    key: "notes_only",
    type: "notes_only",
    label: `仅根据勾选的 ${noteCount} 篇资料`,
    materialPreview: "将读取资料摘要后改写",
    materialText: "",
    recommended: false
  };
}
