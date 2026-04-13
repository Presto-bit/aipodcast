export type ReferenceRagMode = "truncate" | "keyword" | "full_coverage" | "hybrid";

export function buildReferenceJobFields(input: {
  urlListText: string;
  selectedNoteIds: string[];
  /** 与 selectedNoteIds 同序，用于作品卡片展示引用篇名 */
  selectedNoteTitles?: string[];
  referenceExtra: string;
  useRag: boolean;
  ragMaxChars: number;
  referenceRagMode: ReferenceRagMode;
  /** 播客生成：可选混音 */
  mixBgm?: boolean;
  bgmSlot?: "bgm01" | "bgm02";
  bgmGainDb?: number;
}): Record<string, unknown> {
  const url_list = input.urlListText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const reference_texts = input.referenceExtra.trim() ? [input.referenceExtra.trim()] : [];
  const out: Record<string, unknown> = {
    use_rag: input.useRag,
    rag_max_chars: input.ragMaxChars
  };
  if (url_list.length) out.url_list = url_list;
  if (input.selectedNoteIds.length) {
    out.selected_note_ids = input.selectedNoteIds;
    // 与 id 同序；空串表示无标题，由服务端展示为「未命名笔记」，禁止用 UUID 占位
    out.selected_note_titles = input.selectedNoteIds.map((_, i) =>
      String(input.selectedNoteTitles?.[i] ?? "").trim()
    );
  }
  if (reference_texts.length) out.reference_texts = reference_texts;
  if (input.referenceRagMode !== "truncate") out.reference_rag_mode = input.referenceRagMode;
  if (input.mixBgm === true) {
    out.mix_bgm = true;
    if (input.bgmSlot) out.bgm_slot = input.bgmSlot;
    if (input.bgmGainDb !== undefined) out.bgm_gain_db = input.bgmGainDb;
  }
  return out;
}
