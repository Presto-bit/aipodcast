/** 写作 Studio — Work / Manuscript 类型（对齐 docs/product/writing-cursor-studio.md） */

import type { FeatureCore } from "./homeComposerExpertTypes";
import type { NotesAskSessionState } from "./notesAskMemoryTypes";
import type { NotesAskSource } from "./notesAskCitation";

export type StudioAgentIntent =
  | "brief_clarify"
  | "ops_strategy"
  | "manuscript_coach"
  | "revise_coach"
  | "general";

export type StudioAgentTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  streaming?: boolean;
  intent?: StudioAgentIntent;
  /** RAG 问答角标来源（对话区 [n] 点击预览） */
  askSources?: NotesAskSource[];
};

export type StudioChannel = "xhs";

/** draft 为 v3 主状态；briefing / planned 仅兼容旧数据，读盘会迁为 draft */
export type WorkStatus =
  | "draft"
  | "generating"
  | "ready"
  | "shipped"
  | "briefing"
  | "planned";

export type BlockEvidence = "corpus" | "model" | "verify";

export type ManuscriptBlock =
  | { id: string; kind: "title"; text: string; evidence?: BlockEvidence }
  | { id: string; kind: "body"; text: string; evidence?: BlockEvidence }
  | { id: string; kind: "hashtags"; tags: string[] }
  | { id: string; kind: "coverBrief"; text: string };

export type ManuscriptVersion = {
  id: string;
  label: string;
  createdAt: number;
  blocks: ManuscriptBlock[];
  jobId?: string;
  /** 多标题备选时，预览/复制使用的下标（默认 0） */
  primaryTitleIndex?: number;
  /** 纵向时间线：对应 generate/revise Run */
  sourceRunId?: string;
};

export type StudioPlan = {
  goal: string;
  outline: string[];
  materialLabels: string[];
  materialCount: number;
  voiceEnabled: boolean;
  voiceSummary: string;
  risks: string[];
  inferenceSummary: string[];
};

export type PendingPatch = {
  fromVersionId: string;
  proposedBlocks: ManuscriptBlock[];
  summary: string;
  /** 纵向时间线：触发此次改版的 Run */
  sourceRunId?: string;
};

export type StudioRun = {
  id: string;
  tool: "ask" | "plan" | "generate" | "revise";
  status: "running" | "done" | "error";
  summary: string;
  startedAt: number;
  finishedAt?: number;
  jobId?: string;
  /** 纵向时间线：锚定在「收到，开始写稿/改版…」助手句 */
  anchorTurnId?: string;
};

export type StudioWork = {
  id: string;
  channel: StudioChannel;
  title: string;
  /** 已用于 LLM 命名的首条用户句（避免重复请求） */
  titleLlmSource?: string;
  brief: string;
  status: WorkStatus;
  binding: { notebook: string; noteIds: string[] };
  featureCore: FeatureCore;
  allowModelFallback: boolean;
  intake: Record<string, string | string[]>;
  plan?: StudioPlan;
  versions: ManuscriptVersion[];
  activeVersionId: string;
  pendingPatch?: PendingPatch;
  shipChecks: Record<string, boolean>;
  lastJobId?: string;
  runPhase?: string;
  error?: string;
  /** 底部 Agent 对话 */
  agentTurns: StudioAgentTurn[];
  agentSessionState?: NotesAskSessionState | null;
  /** 成稿后「我的特色」引导已关闭 */
  featureNudgeDismissed?: boolean;
  /** 任务级补充规则（可选，无输入 UI 时由计划等写入） */
  workRules?: string;
  /** 子任务轨迹（plan / generate / revise） */
  agentRuns?: StudioRun[];
  /** 最近一次编排说明 */
  lastOrchestratorNote?: string;
  /** @deprecated v3 已移除，读盘 migrate 会清空 */
  postDoneFollowUpPending?: boolean;
  /** @deprecated v3 已移除 */
  postDoneFollowUpDone?: boolean;
  /** @deprecated v3 已移除 */
  postDoneCoach?: string;
  /** @deprecated v3 已移除 */
  postDoneCoachStreaming?: boolean;
  /** 本地 schema 版本，读盘时 migrate */
  schemaVersion?: number;
  updatedAt: number;
  createdAt: number;
};

export const XHS_SHIP_STEPS: { id: string; title: string; copyHint: string }[] = [
  { id: "1", title: "配图", copyHint: "按封面说明做 3 张图" },
  { id: "2", title: "发布", copyHint: "粘贴标题+正文+话题" },
  { id: "3", title: "首评", copyHint: "发引导评论一句" },
  { id: "4", title: "互动", copyHint: "回复前 5 条评论" },
  { id: "5", title: "转发", copyHint: "朋友圈转发语" },
  { id: "6", title: "数据", copyHint: "24h 记录小眼睛/收藏" },
  { id: "7", title: "复盘", copyHint: "哪些标题点击高" }
];

export function workStatusLabel(status: WorkStatus): string {
  switch (status) {
    case "draft":
    case "briefing":
    case "planned":
      return "撰写需求";
    case "generating":
      return "生成中";
    case "ready":
      return "可发布";
    case "shipped":
      return "已发布";
    default:
      return status;
  }
}
