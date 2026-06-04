import {
  parseStudioAgentStructuredResponse,
  studioStructuredAddsAssistantTurn,
  studioStructuredToDisplayText
} from "../studioAgentStructured";

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

console.log("studioAgentStructured.test.ts: ok");
