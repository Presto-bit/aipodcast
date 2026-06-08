import { appendComposeClarifyTurn } from "../studioTimeline";
import {
  blocksFromComposeStream,
  hasComposePreviewContent
} from "../studioComposePreview";
import type { StudioAgentTurn } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const blocks = blocksFromComposeStream(
  [{ id: "body-0", kind: "body", text: "工位忘喝水", evidence: "model" }],
  "工位忘喝水完整版",
  []
);
assert(blocks[0]?.kind === "body" && blocks[0].text === "工位忘喝水完整版", "body delta wins");

assert(hasComposePreviewContent(blocks), "preview has body");

const rewriteTurn = {
  id: "a1",
  role: "assistant" as const,
  content: "rewrite",
  intent: "compose_rewrite" as const,
  createdAt: 1
};
const merged = appendComposeClarifyTurn([rewriteTurn], {
  ...rewriteTurn,
  id: "a2",
  content: "rewrite again",
  createdAt: 2
});
assert(merged.length === 1 && merged[0]?.content === "rewrite again", "dedupe rewrite clarify");

console.log("studioComposePreview.test.ts: ok");
