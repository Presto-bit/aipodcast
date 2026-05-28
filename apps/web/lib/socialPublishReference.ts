/** 自媒体发布：与「生成文章」相同的勾选资料 RAG 引用参数（方案 1：资料全） */

import type { ReferenceRagMode } from "./jobReferencePayload";

/** 与笔记本「生成文章」一致：分层 RAG + 合并上限 */
export const SOCIAL_PUBLISH_RAG_MAX_CHARS = 56_000;
export const SOCIAL_PUBLISH_REFERENCE_RAG_MODE: ReferenceRagMode = "truncate";

export function buildSocialPublishReferenceBody(input: {
  selectedNoteIds: string[];
  selectedNoteTitles?: string[];
  notesSourceOwnerUserId?: string | null;
}): Record<string, unknown> {
  const ids = input.selectedNoteIds.filter(Boolean);
  return {
    selected_note_ids: ids,
    selected_note_titles: ids.map((_, i) => String(input.selectedNoteTitles?.[i] ?? "").trim()),
    use_rag: true,
    rag_max_chars: SOCIAL_PUBLISH_RAG_MAX_CHARS,
    reference_rag_mode: SOCIAL_PUBLISH_REFERENCE_RAG_MODE,
    ...(input.notesSourceOwnerUserId?.trim()
      ? { notes_source_owner_user_id: input.notesSourceOwnerUserId.trim() }
      : {})
  };
}
