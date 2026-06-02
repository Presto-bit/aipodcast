import type { NotesAskSessionState } from "./notesAskMemoryTypes";
import type { SocialPublishDraft } from "./socialPublishTypes";

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
  formats: Partial<Record<HomeComposerFormat, HomeComposerFormatResult>>;
  createdAt: number;
};

export type HomeComposerPrefs = {
  formats: HomeComposerFormat[];
  notebook: string;
  noteIds: string[];
  styleTemplateId: string | null;
  personalEnabled: boolean;
  personalProfile: HomeComposerPersonalProfile | null;
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
  v: 1;
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
    notebook: "",
    noteIds: [],
    styleTemplateId: null,
    personalEnabled: false,
    personalProfile: null
  };
}
