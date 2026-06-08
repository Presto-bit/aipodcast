import {
  buildStudioCorpusSources,
  splitCorpusAnchorSegments,
  textHasCorpusAnchors
} from "../studioCorpusAnchor";
import { shouldForceStudioCompose } from "../studioComposeChip";
import { shouldSuppressStudioCanvasReply, userMessageLooksLikeQuestion } from "../studioAgentStructured";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  splitCorpusAnchorSegments("见[资料1]与[资料2]").filter((s) => s.kind === "anchor").length === 2,
  "split corpus anchors"
);
assert(textHasCorpusAnchors("引用[资料3]"), "detect anchor token");
assert(buildStudioCorpusSources("nb", ["n1", "n2"])[1]?.index === "2", "source index");

assert(shouldForceStudioCompose("场景：办公室", true), "chip forces compose");
assert(shouldForceStudioCompose("按已有信息先写一版", false), "rewrite chip forces compose");
assert(!shouldForceStudioCompose("继续问发布与推广细节", false), "ops chip does not force compose");

assert(userMessageLooksLikeQuestion("钩子怎么写？"), "question mark");
assert(
  shouldSuppressStudioCanvasReply(
    {
      status: "ready",
      versions: [{ id: "v1", label: "v1", createdAt: 1, blocks: [] }],
      binding: { notebook: "", noteIds: [] },
      agentTurns: []
    } as unknown as import("../studioWorkTypes").StudioWork,
    "好的"
  ),
  "suppress short ack after ready"
);

console.log("studioCorpusAnchor.test.ts ok");
