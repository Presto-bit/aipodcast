import type { AssistantBlock, PlatformExpertId } from "./homeComposerExpertTypes";
import type { FeatureCore } from "./homeComposerExpertTypes";

export type ComposerIntakeApiRequest = {
  expertId: PlatformExpertId;
  taskSentence: string;
  intakeStep: number;
  intake: Record<string, string | string[]>;
  notebook?: string;
  noteCount?: number;
  featureCore?: FeatureCore;
  personalEnabled?: boolean;
};

export type ComposerIntakeApiResponse = {
  expertStrip: Extract<AssistantBlock, { kind: "expert_strip" }>;
  intakeStep: Extract<AssistantBlock, { kind: "intake_step" }>;
  preselected: Record<string, string | string[]>;
  skipStep2: boolean;
  hint?: string;
};

export async function fetchComposerExpertIntake(
  body: ComposerIntakeApiRequest,
  authHeaders: Record<string, string>
): Promise<ComposerIntakeApiResponse> {
  const res = await fetch("/api/composer/expert/intake", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body)
  });
  const data = (await res.json().catch(() => ({}))) as ComposerIntakeApiResponse & { detail?: string; error?: string };
  if (!res.ok) {
    throw new Error(String(data.detail || data.error || `intake 请求失败 ${res.status}`));
  }
  return data;
}
