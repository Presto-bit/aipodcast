import { createJob } from "./api";
import { apiErrorMessage } from "./apiError";
import { NOTES_PODCAST_PROJECT_NAME } from "./notesProject";
import type {
  ExpertDeliverable,
  OpsPlaybookStep,
  PlatformExpertId,
  XhsContent
} from "./homeComposerExpertTypes";
import type { FeatureCore } from "./homeComposerExpertTypes";
import { parseExpertDeliverable, validateExpertDeliverable } from "./validateExpertDeliverable";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 20 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ComposerExpertJobInput = {
  expertId: PlatformExpertId;
  taskSentence: string;
  intake: Record<string, string | string[]>;
  notebook: string;
  noteIds: string[];
  featureCore?: FeatureCore;
  stylePrompt?: string;
  authorPrompt?: string;
  authHeaders: Record<string, string>;
  createdBy?: string;
  onProgress?: (message: string, progress?: number) => void;
};

export type ComposerExpertJobResult =
  | { status: "done"; jobId: string; deliverable: ExpertDeliverable }
  | { status: "error"; error: string; jobId?: string };

async function fetchJobRow(jobId: string, authHeaders: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { ...authHeaders }
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(apiErrorMessage(data, `查询任务失败（HTTP ${res.status}）`));
  }
  return data;
}

function progressMessage(row: Record<string, unknown>): string {
  const progress = typeof row.progress === "number" ? row.progress : undefined;
  const st = String(row.status || "").trim();
  if (progress != null && progress >= 70) return "正在生成发布傻瓜包…";
  if (progress != null && progress >= 55) return "正在生成内容成品…";
  if (progress != null && progress >= 20) return "正在检索资料…";
  if (st === "queued") return "云端排队中…";
  return "处理中…";
}

export async function runComposerExpertDeliverableJob(
  input: ComposerExpertJobInput
): Promise<ComposerExpertJobResult> {
  const hasNotes = input.noteIds.length > 0;

  try {
    const job = await createJob({
      project_name: NOTES_PODCAST_PROJECT_NAME,
      job_type: "composer_expert_deliverable",
      queue_name: "ai",
      created_by: input.createdBy || undefined,
      payload: {
        expertId: input.expertId,
        taskSentence: input.taskSentence.trim(),
        intake: input.intake,
        featureCore: input.featureCore ?? {},
        style_prompt: input.stylePrompt?.trim() || "",
        author_prompt: input.authorPrompt?.trim() || "",
        playbookVersion: `${input.expertId}@1`,
        source_type: hasNotes ? "notes_rag" : "composer_prompt",
        use_rag: hasNotes,
        rag_max_chars: 56_000,
        ...(hasNotes
          ? {
              selected_note_ids: input.noteIds,
              notes_notebook: input.notebook.trim()
            }
          : {})
      }
    });

    const jobId = String(job.id || "").trim();
    if (!jobId) {
      return { status: "error", error: "创建任务失败" };
    }

    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      const row = await fetchJobRow(jobId, input.authHeaders);
      const st = String(row.status || "").trim();
      input.onProgress?.(progressMessage(row), typeof row.progress === "number" ? row.progress : undefined);

      if (st === "succeeded") {
        const result = row.result;
        if (!result || typeof result !== "object") {
          return { status: "error", jobId, error: "任务完成但未返回 deliverable" };
        }
        const raw = (result as Record<string, unknown>).deliverable ?? result;
        const check = validateExpertDeliverable(raw);
        if (!check.ok) {
          return { status: "error", jobId, error: check.errors.join("；") };
        }
        const deliverable = parseExpertDeliverable(raw);
        if (!deliverable) {
          return { status: "error", jobId, error: "deliverable 解析失败" };
        }
        return { status: "done", jobId, deliverable };
      }
      if (st === "failed" || st === "cancelled") {
        const errMsg = String(row.error_message || "").trim();
        return {
          status: "error",
          jobId,
          error: errMsg || (st === "cancelled" ? "任务已取消" : "生成失败")
        };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: "error", jobId, error: "生成超时，请稍后在作品页查看" };
  } catch (err) {
    return { status: "error", error: String(err instanceof Error ? err.message : err) };
  }
}

export function deliverablePreviewText(deliverable: ExpertDeliverable): string {
  if (deliverable.expertId === "xhs_ops" && "body" in deliverable.content) {
    const c = deliverable.content;
    const tags = c.hashtags?.length ? `\n\n${c.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}` : "";
    return `${c.body.trim()}${tags}`;
  }
  return JSON.stringify(deliverable.content, null, 2);
}

export function deliverableTitleText(deliverable: ExpertDeliverable, index = 0): string {
  if (deliverable.expertId === "xhs_ops" && "titles" in deliverable.content) {
    const titles = deliverable.content.titles;
    return titles[index]?.trim() || titles[0]?.trim() || "";
  }
  if (deliverable.expertId === "mp_ops" && "title" in deliverable.content) {
    return deliverable.content.title.trim();
  }
  return "";
}

export function deliverableBodyText(deliverable: ExpertDeliverable): string {
  if (deliverable.expertId === "xhs_ops" && "body" in deliverable.content) {
    return deliverable.content.body.trim();
  }
  if (deliverable.expertId === "mp_ops" && "bodyMarkdown" in deliverable.content) {
    return deliverable.content.bodyMarkdown.trim();
  }
  return deliverablePreviewText(deliverable);
}

export function opsStepCopyText(step: OpsPlaybookStep): string {
  const lines = [`${step.stepNo}. ${step.title}`, step.objective, ...step.actions];
  if (step.copyBlocks?.length) {
    for (const block of step.copyBlocks) {
      lines.push(`${block.label}：${block.text}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

export function opsTierSummary(steps: OpsPlaybookStep[]): {
  mustDo: number;
  niceToHave: number;
  afterPublish: number;
} {
  return {
    mustDo: steps.filter((s) => s.tier === "must_do").length,
    niceToHave: steps.filter((s) => s.tier === "nice_to_have").length,
    afterPublish: steps.filter((s) => s.tier === "after_publish").length
  };
}

export function xhsBodyPreviewLines(body: string, maxLines = 5): string {
  return body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && idx < arr.length - 1))
    .slice(0, maxLines)
    .join("\n");
}

export function isXhsContent(content: ExpertDeliverable["content"]): content is XhsContent {
  return "body" in content && "titles" in content && "cover" in content;
}
