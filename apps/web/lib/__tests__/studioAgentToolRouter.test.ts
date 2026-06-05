import {
  parseStudioAgentRouteEvent,
  studioAgentRouteHint
} from "../studioAgentToolRouter";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const route = parseStudioAgentRouteEvent({
  type: "route",
  tool: "compose",
  source: "llm",
  reason: "LLM：compose"
});
assert(route?.tool === "compose", "parse compose route");
assert(studioAgentRouteHint(route!) === "信息够了，开始写稿…", "compose hint");

console.log("studioAgentToolRouter.test.ts: ok");
