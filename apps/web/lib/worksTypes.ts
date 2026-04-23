export type WorkItem = {
  id?: string;
  /** 与 orchestrator projects.name 对应，用于区分入口（如笔记播客专用项目） */
  projectName?: string;
  title?: string;
  createdAt?: string;
  audioUrl?: string;
  scriptUrl?: string;
  scriptText?: string;
  type?: string;
  /** 列表接口在存在 audio_hex 或 audio_object_key 时为 true（用于一键转视频等） */
  hasAudioHex?: boolean;
  /** 是否允许打包下载：用户须在钱包中有过充值流水（user_wallet_topups），与订阅档位无关 */
  downloadAllowed?: boolean;
  /** 秒；来自任务 result.audio_duration_sec */
  audioDurationSec?: number | null;
  status?: string;
  coverImage?: string;
  /** 终态 result.script_char_count；旧任务可能缺失 */
  scriptCharCount?: number;
  /** 来自 payload.notes_notebook 或 result */
  notesSourceNotebook?: string;
  /** 因删除笔记本被移入回收站并恢复后：仍在一级「我的作品」显示，但不再出现在笔记本侧栏 */
  notesNotebookStudioDetached?: boolean;
  /** 所选笔记条数 */
  notesSourceNoteCount?: number;
  /** 引用笔记标题（与创建任务时勾选顺序一致；条数与套餐笔记引用上限一致） */
  notesSourceTitles?: string[];
  /** 来自任务 payload.program_name / result，用于作品导航页二级体裁（如深度讨论、笔记文章类目） */
  workProgramName?: string;
  /** 管理员标记的全站播客创作模板；复用/试听走专用接口 */
  isPodcastPublicTemplate?: boolean;
};

/** 编排器内部任务，不应出现在「我的作品」/首页最近成品等用户向列表（与 list_recent_works 过滤一致） */
export function shouldHideWorkFromUserGallery(work: Pick<WorkItem, "type">): boolean {
  return String(work.type || "") === "note_rag_index";
}

/** 合并 ai / tts / notes 桶并排序，排除内部任务类型 */
export function mergeUserFacingWorksByRecency(ai: WorkItem[], tts: WorkItem[], notes: WorkItem[]): WorkItem[] {
  const map = new Map<string, WorkItem>();
  for (const x of [...ai, ...tts, ...notes]) {
    if (shouldHideWorkFromUserGallery(x)) continue;
    const id = String(x.id || "").trim();
    if (!id) continue;
    if (!map.has(id)) map.set(id, x);
  }
  return [...map.values()].sort((a, b) => {
    const ta = new Date(String(a.createdAt || 0)).getTime();
    const tb = new Date(String(b.createdAt || 0)).getTime();
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
}
