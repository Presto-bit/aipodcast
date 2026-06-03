import type { NotesAskSessionState } from "./notesAskMemoryTypes";
import type { SocialPublishDraft } from "./socialPublishTypes";
import type {
  ComposerExpertSelection,
  ExpertTaskDraft,
  FeatureCore,
  PersonalFeaturePreferences,
  PlatformExpertId,
  WritingHabitMode,
  AssistantBlock
} from "./homeComposerExpertTypes";
import { defaultComposerExpertSelection } from "./composerExperts";
import { EMPTY_FEATURE_CORE } from "./homeComposerFeatureCore";

export type HomeComposerFormat = "xhs" | "mp" | "voice" | "podcast";

export type HomeComposerPersonalProfile = {
  identity: string;
  currentDoing: string;
  pastExperience: string;
  difficulties: string;
  choices: string;
  results: string;
  remember: string;
  values: string;
  other: string;
};

export const EMPTY_HOME_COMPOSER_PERSONAL: HomeComposerPersonalProfile = {
  identity: "",
  currentDoing: "",
  pastExperience: "",
  difficulties: "",
  choices: "",
  results: "",
  remember: "",
  values: "",
  other: ""
};

export type HomeComposerFormatResult =
  | { status: "pending" | "running"; progress?: string; jobId?: string }
  | { status: "done"; jobId: string; social?: SocialPublishDraft; scriptText?: string }
  | { status: "error"; error: string; jobId?: string };

export type HomeComposerTurn = {
  id: string;
  userText: string;
  general?: {
    content: string;
    supplementContent?: string;
    streaming?: boolean;
    streamingPhase?: string;
  };
  /** @deprecated PR-2 起由专家 deliverable 替代；PR-0/1 保留兼容旧 format Job */
  formats: Partial<Record<HomeComposerFormat, HomeComposerFormatResult>>;
  /** 专家任务流块（intake / confirm / progress / deliverable） */
  blocks?: AssistantBlock[];
  /** 用户点「改聊一下」后归档，块只读展示 */
  taskFlowArchived?: boolean;
  /** 本 turn 启动时选中的专家（换专家后仍正确展示历史） */
  expertId?: PlatformExpertId;
  expertJobId?: string;
  createdAt: number;
};

export type HomeComposerPrefs = {
  /** @deprecated 由 expert 单选替代；迁移期仍可读 */
  formats: HomeComposerFormat[];
  expert: ComposerExpertSelection;
  notebook: string;
  noteIds: string[];
  styleTemplateId: string | null;
  writingHabitMode: WritingHabitMode;
  personalEnabled: boolean;
  personalProfile: HomeComposerPersonalProfile | null;
  featureCore: FeatureCore;
  personalDisabledByUser?: boolean;
  personalFeaturePreferences?: PersonalFeaturePreferences;
  taskDraft?: ExpertTaskDraft;
  lastDeliverableId?: string;
};

export type HomeComposerSession = {
  id: string;
  title: string;
  updatedAt: number;
  prefs: HomeComposerPrefs;
  sessionState: NotesAskSessionState | null;
  turns: HomeComposerTurn[];
};

export type HomeComposerStore = {
  v: 1 | 2;
  activeSessionId: string;
  sessions: HomeComposerSession[];
};

export const HOME_COMPOSER_FORMAT_LABELS: Record<HomeComposerFormat, string> = {
  xhs: "小红书",
  mp: "公众号",
  voice: "口播",
  podcast: "播客"
};

export const HOME_COMPOSER_FORMATS: { id: HomeComposerFormat; label: string }[] = [
  { id: "xhs", label: "小红书" },
  { id: "mp", label: "公众号" },
  { id: "voice", label: "口播" },
  { id: "podcast", label: "播客" }
];

export function defaultHomeComposerPrefs(): HomeComposerPrefs {
  return {
    formats: [],
    expert: defaultComposerExpertSelection(),
    notebook: "",
    noteIds: [],
    styleTemplateId: null,
    writingHabitMode: "neutral",
    personalEnabled: false,
    personalProfile: null,
    featureCore: { ...EMPTY_FEATURE_CORE },
    personalFeaturePreferences: { learnedTraits: [] }
  };
}
