import {
  parseStudioAgentToolCall,
  studioAgentRouteHint
} from "../studioAgentToolSchema";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const call = parseStudioAgentToolCall({
  tool: "compose",
  brief: "推广杯子",
  reason: "brief足够"
});
assert(call?.tool === "compose", "parse tool call");

assert(
  studioAgentRouteHint({ tool: "reply" }, "ask").includes("问答"),
  "ask mode reply hint"
);
assert(
  studioAgentRouteHint({ tool: "compose" }, "write").includes("写稿"),
  "write mode compose hint"
);

console.log("studioAgentToolSchema.test.ts: ok");
