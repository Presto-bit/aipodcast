import { createJob } from "./api";
import { resolveJobScriptBodyText } from "./jobScriptText";
import { NOTES_PODCAST_PROJECT_NAME } from "./notesProject";
import {
  buildOptionsPayload,
  defaultAdvancedOptions,
  defaultPersonaOptions,
  defaultQuickOptions
} from "./socialPublishPresets";
import { buildSocialPublishReferenceBody } from "./socialPublishReference";
import { mapContentDraft, waitForSocialPublishJob } from "./socialPublishApi";
import type { SocialPublishDraft, SocialPublishPlatform } from "./socialPublishTypes";
import type { HomeComposerFormat } from "./homeComposerTypes";
import { buildReferenceJobFields } from "./jobReferencePayload";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 20 * 60 * 1000;
const MAX_PARALLEL = 2;
/** 首页 Composer 无资料时：用户输入 + 通识回答合并素材下限 */
export const COMPOSER_SOCIAL_MATERIAL_MIN_CHARS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatToPlatform(format: HomeComposerFormat): SocialPublishPlatform | null {
  if (format === "xhs") return "xiaohongshu";
  if (format === "mp") return "wechat_mp";
  return null;
}

async function waitForScriptDraftJob(params: {
  jobId: string;
  authHeaders: Record<string, string>;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/jobs/${encodeURIComponent(params.jobId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { ...params.authHeaders }
    });
    const row = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(row.error_message || row.detail || `查询任务失败 ${res.status}`));
    }
    const st = String(row.status || "").trim();
    if (st === "succeeded") {
      return resolveJobScriptBodyText(params.jobId, row, params.authHeaders);
    }
    if (st === "failed" || st === "cancelled") {
      throw new Error(String(row.error_message || (st === "cancelled" ? "任务已取消" : "生成失败")));
    }
    params.onProgress?.(st === "queued" ? "排队中…" : "正在生成…");
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("生成超时，请稍后在作品页查看");
}

export type HomeComposerFormatJobInput = {
  format: HomeComposerFormat;
  userPrompt: string;
  generalAnswer?: string;
  notebook: string;
  noteIds: string[];
  noteTitles: string[];
  stylePrompt?: string;
  authorIpPrompt?: string;
  authHeaders: Record<string, string>;
  createdBy?: string;
  onProgress?: (message: string) => void;
};

export type HomeComposerFormatJobResult =
  | { format: HomeComposerFormat; status: "done"; jobId: string; social?: SocialPublishDraft; scriptText?: string }
  | { format: HomeComposerFormat; status: "error"; error: string; jobId?: string };

async function runSingleFormatJob(input: HomeComposerFormatJobInput): Promise<HomeComposerFormatJobResult> {
  const platform = formatToPlatform(input.format);
  const materialContext = [input.userPrompt.trim(), input.generalAnswer?.trim()].filter(Boolean).join("\n\n");

  try {
    if (platform) {
      const hasNotes = input.noteIds.length > 0;
      if (!hasNotes && materialContext.length < COMPOSER_SOCIAL_MATERIAL_MIN_CHARS) {
        return {
          format: input.format,
          status: "error",
          error: `内容过短（至少约 ${COMPOSER_SOCIAL_MATERIAL_MIN_CHARS} 字），请补充输入或等待通识回答完成`
        };
      }
      const persona = defaultPersonaOptions(platform);
      const otherReq = [input.stylePrompt?.trim(), input.authorIpPrompt?.trim()].filter(Boolean).join("\n\n");
      const options = buildOptionsPayload(
        defaultQuickOptions(platform),
        defaultAdvancedOptions(platform),
        { ...persona, otherRequirements: otherReq },
        platform
      );
      const refBody = hasNotes
        ? buildSocialPublishReferenceBody({
            selectedNoteIds: input.noteIds,
            selectedNoteTitles: input.noteTitles
          })
        : {};
      const job = await createJob({
        project_name: NOTES_PODCAST_PROJECT_NAME,
        job_type: "social_publish_draft",
        queue_name: "ai",
        created_by: input.createdBy || undefined,
        payload: {
          platform,
          options,
          source_type: hasNotes ? "notes_rag" : "composer_prompt",
          ...(hasNotes
            ? {
                notes_notebook: input.notebook.trim(),
                use_rag: true,
                rag_max_chars: 56_000,
                ...refBody
              }
            : { material_text: materialContext })
        }
      });
      const jobId = String(job.id || "").trim();
      if (!jobId) throw new Error("创建任务失败");
      input.onProgress?.("已提交队列…");
      const social = await waitForSocialPublishJob({
        jobId,
        platform,
        authHeaders: input.authHeaders,
        onProgress: input.onProgress
      });
      return { format: input.format, status: "done", jobId, social };
    }

    const isPodcast = input.format === "podcast";
    const targetChars = isPodcast ? 900 : 650;
    const programName = isPodcast ? "播客大纲" : "口播脚本";
    const styleParts = [
      input.stylePrompt?.trim(),
      input.authorIpPrompt?.trim(),
      isPodcast ? "输出播客节目大纲，含节目名、时长、结构要点；P0 仅文本大纲，不含 TTS。" : "输出口播提词器脚本，含时间轴标记。"
    ].filter(Boolean);

    const payload: Record<string, unknown> = {
      text: materialContext,
      script_target_chars: targetChars,
      script_language: "中文",
      program_name: programName,
      script_style: styleParts.join("\n"),
      output_mode: "article"
    };

    if (input.noteIds.length > 0 && input.notebook.trim()) {
      Object.assign(
        payload,
        buildReferenceJobFields({
          urlListText: "",
          selectedNoteIds: input.noteIds,
          selectedNoteTitles: input.noteTitles,
          referenceExtra: materialContext.slice(0, 2000),
          useRag: true,
          ragMaxChars: 56_000,
          referenceRagMode: "truncate"
        }),
        { notes_notebook: input.notebook.trim() }
      );
    }

    const job = await createJob({
      project_name: NOTES_PODCAST_PROJECT_NAME,
      job_type: "script_draft",
      queue_name: "ai",
      created_by: input.createdBy || undefined,
      payload
    });
    const jobId = String(job.id || "").trim();
    if (!jobId) throw new Error("创建任务失败");
    input.onProgress?.("已提交队列…");
    const scriptText = await waitForScriptDraftJob({
      jobId,
      authHeaders: input.authHeaders,
      onProgress: input.onProgress
    });
    return { format: input.format, status: "done", jobId, scriptText };
  } catch (err) {
    return {
      format: input.format,
      status: "error",
      error: String(err instanceof Error ? err.message : err)
    };
  }
}

/** 最多 2 路并行执行格式 job */
export async function runHomeComposerFormatJobs(
  formats: HomeComposerFormat[],
  base: Omit<HomeComposerFormatJobInput, "format" | "onProgress">,
  onFormatProgress?: (format: HomeComposerFormat, message: string) => void
): Promise<HomeComposerFormatJobResult[]> {
  const queue = [...formats];
  const results: HomeComposerFormatJobResult[] = [];
  const workers = Array.from({ length: Math.min(MAX_PARALLEL, queue.length || 1) }, async () => {
    while (queue.length) {
      const format = queue.shift();
      if (!format) break;
      const result = await runSingleFormatJob({
        ...base,
        format,
        onProgress: (msg) => onFormatProgress?.(format, msg)
      });
      results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

export function socialDraftToCopyText(draft: SocialPublishDraft, titleIndex = 0): string {
  const title = draft.titles[titleIndex] || draft.titles[0] || "";
  const body = draft.body.trim();
  const tags = draft.platform === "xiaohongshu" ? draft.body.match(/#[^\s#]+/g)?.join(" ") : "";
  return [title, "", body, tags ? `\n${tags}` : ""].filter(Boolean).join("\n");
}

export { mapContentDraft };
