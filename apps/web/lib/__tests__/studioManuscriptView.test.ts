import { normalizeStudioComposeBrief } from "../studioComposeBrief";
import {
  buildManuscriptFlowText,
  parseManuscriptBodySegments,
  resolveBodyForTitleIndex,
  resolveManuscriptVariant,
  studioTitleDirectionHint,
  studioTitleDirectionLabel
} from "../studioManuscriptView";
import type { ManuscriptBlock } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  normalizeStudioComposeBrief("推广小红树杯子\n职场女性\n提醒喝水").includes("小红书"),
  "typo fix"
);
assert(
  normalizeStudioComposeBrief("推广杯子\n职场女性\n提醒喝水").includes("，"),
  "fragment merge"
);

const blocks: ManuscriptBlock[] = [
  { id: "title-0", kind: "title", text: "标题A", directionLabel: "避坑向", directionHint: "列常见错误" },
  { id: "title-1", kind: "title", text: "标题B", directionLabel: "案例向", directionHint: "讲真实经历" },
  { id: "body-0", kind: "body", text: "正文A\n\n第二段" },
  { id: "body-1", kind: "body", text: "正文B" }
];

assert(resolveBodyForTitleIndex(blocks, 1)?.text === "正文B", "body by index");
assert(
  resolveManuscriptVariant(blocks, 1).body === "正文B",
  "variant body by index"
);
assert(
  buildManuscriptFlowText({ title: "标题A", body: "行1\n\n行2", interaction: "评论区聊聊" }) ===
    "标题A 行1 行2 评论区聊聊",
  "flatten flow with interaction"
);
assert(studioTitleDirectionLabel(0, blocks[0] as Extract<ManuscriptBlock, { kind: "title" }>) === "避坑向", "direction from block");
assert(studioTitleDirectionHint(1, blocks[1] as Extract<ManuscriptBlock, { kind: "title" }>) === "讲真实经历", "hint from block");
assert(studioTitleDirectionLabel(0) === "痛点向", "fallback direction label");
assert(studioTitleDirectionHint(1) === "激发好奇心", "fallback direction hint");
const segs = parseManuscriptBodySegments("第一段。\n\n第二段。\n\n· 要点一\n· 要点二");
assert(segs.length === 3 && segs[2]?.kind === "list", "list segments");

console.log("studioManuscriptView.test.ts: ok");
