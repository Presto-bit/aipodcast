/** 创作向专家模式 — 类型契约（对齐 docs/product/home-composer-experts.md §11） */

export type PlatformExpertId = "xhs_ops" | "mp_ops" | "voice_gen" | "podcast_plan";

export type ComposerExpertSelection =
  | { mode: "none" }
  | { mode: "platform"; expertId: PlatformExpertId };

export type TaskPhase = "idle" | "intake" | "confirm" | "generate" | "deliver" | "review" | "revise";

export type ExpertTaskDraft = {
  expertId: PlatformExpertId;
  phase: TaskPhase;
  taskSentence: string;
  intake: Record<string, string | string[]>;
  intakeStep: number;
  confirmAck?: boolean;
  skipStep2?: boolean;
  turnId: string;
  updatedAt: string;
};

export type CorpusCoverage = "full" | "partial" | "none";

export type WritingHabitMode = "neutral" | "notebook" | "template" | "off";

export type FeatureCore = {
  who: string;
  remember: string;
  avoid: string;
};

export type PersonalFeaturePreferences = {
  learnedTraits: string[];
};

export type XhsCoverSpec = {
  headline: string;
  subline?: string;
  layout: "text_top" | "text_center" | "screenshot_plus_banner";
  palette?: { background: string; text: string };
  slides: Array<{
    role: "cover" | "inner";
    description: string;
    onImageText?: string;
  }>;
};

export type XhsContent = {
  titles: string[];
  body: string;
  /** best-of-3 正文变体，与 titles 一一对应 */
  bodies?: string[];
  /** 与 bodies 对应的互动引导句 */
  interactions?: string[];
  hashtags: string[];
  cover: XhsCoverSpec;
};

export type MpContent = {
  title: string;
  summary: string;
  bodyMarkdown: string;
};

export type VoiceContent = {
  durationHint: string;
  wordCount: number;
  scriptTimeline: string;
};

export type PodcastContent = {
  showTitle: string;
  durationHint: string;
  outline: string;
  scriptExcerpt?: string;
};

export type OpsStepTier = "must_do" | "nice_to_have" | "after_publish";

export type OpsPlaybookStep = {
  stepNo: number;
  title: string;
  objective: string;
  actions: string[];
  copyBlocks?: Array<{ label: string; text: string }>;
  timing?: string;
  metrics?: string[];
  tier: OpsStepTier;
  defaultExpanded: boolean;
  collapsedSummary?: string;
};

export type OpsPlaybook = {
  expertId: PlatformExpertId;
  steps: OpsPlaybookStep[];
  recapStepNo: number;
};

export type ProvenanceBar = {
  corpusCoverage: CorpusCoverage;
  materialLabels?: string[];
  corpusSegments?: string[];
  supplementSegments?: string[];
};

export type FeatureUsage = {
  applied: boolean;
  summaryLine: string;
  items?: string[];
};

export type DeliverableMeta = {
  rationale: string[];
  expectedEffect: string;
  provenance: ProvenanceBar;
  playbookVersion: string;
  featureUsage?: FeatureUsage;
};

export type ExpertDeliverable = {
  expertId: PlatformExpertId;
  content: XhsContent | MpContent | VoiceContent | PodcastContent;
  ops: OpsPlaybook;
  meta: DeliverableMeta;
};

export type MaterialPlan = {
  notebook: string;
  noteCount: number;
  previewTitles?: string[];
  intendedUse?: string;
  coverageEstimate?: CorpusCoverage;
  disclaimer?: string;
};

export type IntakeOption = {
  id: string;
  label: string;
  exclusiveGroup?: string;
};

export type AssistantBlock =
  | { kind: "expert_strip"; persona: string; methodology: string; toolchain: string }
  | {
      kind: "intake_step";
      step: number;
      total: number;
      theme: string;
      fields: Array<{
        fieldId: string;
        prompt: string;
        multi: boolean;
        minSelect?: number;
        maxSelect?: number;
        options: IntakeOption[];
        allowOther?: boolean;
        hint?: string;
        preselected?: string[];
      }>;
    }
  | {
      kind: "confirm";
      summary: string;
      intake: Record<string, unknown>;
      toolchain: string[];
      materialPlan?: MaterialPlan;
      featureStrip?: { enabled: boolean; summary?: string; warning?: string };
      disclaimer?: string;
      /** WorkBuddy 式 Resolution：confirmation 单卡 / clarification 澄清 */
      resolutionMode?: "confirmation" | "clarification";
      inferenceSummary?: string[];
      hint?: string;
    }
  | {
      kind: "clarification";
      message: string;
      expertId?: PlatformExpertId;
      taskSentence?: string;
    }
  | {
      kind: "review";
      deliverableId?: string;
      summaryLine?: string;
    }
  | { kind: "progress"; steps: Array<{ label: string; status: "done" | "active" | "pending" }> }
  | {
      kind: "deliverable";
      expertId: PlatformExpertId;
      content: XhsContent | MpContent | VoiceContent | PodcastContent;
      ops: OpsPlaybook;
      meta: DeliverableMeta;
    }
  | {
      kind: "feedback";
      deliverableId: string;
      chips: string[];
      submitted?: "positive" | "negative";
      selectedChip?: string;
      negativeReason?: string;
    }
  | { kind: "analysis_collapsed"; content: string }
  | { kind: "intent_suggest"; expertId: PlatformExpertId; message: string };

export type ExpertValidationResult = { ok: true } | { ok: false; errors: string[] };
