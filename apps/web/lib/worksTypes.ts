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
  /** 是否允许打包下载：Basic+/按量，或免费档下本任务曾发生套餐外扣费（钱包/按量分钟） */
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
};
