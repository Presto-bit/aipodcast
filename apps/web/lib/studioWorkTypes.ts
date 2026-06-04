/** 写作 Studio — Work / Manuscript 类型（对齐 docs/product/writing-cursor-studio.md） */

import type { FeatureCore } from "./homeComposerExpertTypes";
import type { NotesAskSessionState } from "./notesAskMemoryTypes";

export type StudioAgentTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  streaming?: boolean;
};

export type StudioChannel = "xhs";

export type WorkStatus = "briefing" | "planned" | "generating" | "ready" | "shipped";

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
};

export type StudioWork = {
  id: string;
  channel: StudioChannel;
  title: string;
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
  /** 底部 Agent 对话（需求澄清；不替代 Brief/Plan 门禁） */
  agentTurns: StudioAgentTurn[];
  agentSessionState?: NotesAskSessionState | null;
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
    case "briefing":
      return "撰写需求";
    case "planned":
      return "待确认计划";
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
