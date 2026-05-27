/** 自媒体发布：与生成文章相同的勾选资料 RAG 引用参数 */

import type { ReferenceRagMode } from "./jobReferencePayload";

/** 自媒体发布：默认直读勾选笔记正文，不走分层 RAG（避免把检索说明塞进成稿、并缩短耗时） */
export const SOCIAL_PUBLISH_RAG_MAX_CHARS = 12_000;
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
    use_rag: false,
    notes_reference_full_text: true,
    rag_max_chars: SOCIAL_PUBLISH_RAG_MAX_CHARS,
    reference_rag_mode: SOCIAL_PUBLISH_REFERENCE_RAG_MODE,
    ...(input.notesSourceOwnerUserId?.trim()
      ? { notes_source_owner_user_id: input.notesSourceOwnerUserId.trim() }
      : {})
  };
}
