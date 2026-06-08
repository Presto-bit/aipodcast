import {
  draftAskFallbackText,
  parseStudioAgentStructuredResponse,
  resolveStudioStructuredResponse,
  studioStructuredAddsAssistantTurn,
  studioStructuredToDisplayText
} from "../studioAgentStructured";
import type { StudioWork } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const cases: { raw: string; kind: string; text?: string }[] = [
  { raw: '{"kind":"silent"}', kind: "silent" },
  { raw: '{"kind":"reply","text":"你好"}', kind: "reply", text: "你好" },
  { raw: '{"kind":"ask_user","question":"受众是谁？"}', kind: "ask_user", text: "受众是谁？" },
  { raw: "", kind: "silent" },
  { raw: "普通一句回复", kind: "reply", text: "普通一句回复" }
];

for (const c of cases) {
  const parsed = parseStudioAgentStructuredResponse(c.raw);
  assert(parsed.kind === c.kind, `kind ${c.raw} -> ${parsed.kind}`);
  if (c.text) {
    assert(studioStructuredToDisplayText(parsed) === c.text, `text mismatch for ${c.raw}`);
  }
}

assert(!studioStructuredAddsAssistantTurn({ kind: "silent" }), "silent should not add turn");
assert(studioStructuredAddsAssistantTurn({ kind: "reply", text: "x" }), "reply should add turn");

const fullTaskWork = {
  status: "draft",
  versions: [],
  binding: { notebook: "", noteIds: [] },
  agentTurns: [{ id: "u1", role: "user", content: "写一篇清单体小红书给产品新人", createdAt: 1 }]
} as StudioWork;
const suppressed = resolveStudioStructuredResponse(
  fullTaskWork,
  { kind: "ask_user", question: "受众是谁？" },
  "写一篇清单体小红书给产品新人"
);
assert(suppressed.kind === "silent", "ask_user should suppress when auto-generate");

const vagueWork = {
  status: "draft",
  versions: [],
  binding: { notebook: "", noteIds: [] },
  agentTurns: [{ id: "u1", role: "user", content: "帮我想想", createdAt: 1 }]
} as StudioWork;
const kept = resolveStudioStructuredResponse(
  vagueWork,
  { kind: "ask_user", question: "想写什么主题？" },
  "帮我想想"
);
assert(kept.kind === "ask_user", "ask_user should remain when info insufficient");

const fallback = draftAskFallbackText(vagueWork, "帮我想想", '{"kind":"silent"}');
assert(Boolean(fallback?.trim()), "silent on vague draft should get fallback");

const clarifyWork = {
  ...vagueWork,
  agentTurns: [
    { id: "u1", role: "user", content: "帮我想想", createdAt: 1 },
    {
      id: "a1",
      role: "assistant",
      content: "补 1 项",
      intent: "brief_clarify",
      createdAt: 2
    }
  ]
} as StudioWork;
assert(
  draftAskFallbackText(clarifyWork, "场景：办公室", '{"kind":"silent"}', clarifyWork.agentTurns) === null,
  "no generic fallback after clarify turn"
);

console.log("studioAgentStructured.test.ts: ok");
