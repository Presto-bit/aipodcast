import { parseStudioAgentStep, upsertAgentStep } from "../studioAgentSteps";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const s1 = parseStudioAgentStep({
  type: "step",
  id: "read_manuscript",
  label: "读取当前稿件",
  status: "running",
  tool: "read_manuscript"
});
assert(s1?.id === "read_manuscript", "parse step");

const merged = upsertAgentStep([], s1!);
const merged2 = upsertAgentStep(merged, { ...s1!, status: "done" });
assert(merged2.length === 1 && merged2[0]?.status === "done", "upsert step");

console.log("studioAgentSteps.test.ts: ok");
