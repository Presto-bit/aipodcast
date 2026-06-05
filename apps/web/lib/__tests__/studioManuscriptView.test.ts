import { normalizeStudioComposeBrief } from "../studioComposeBrief";
import {
  buildManuscriptFlowText,
  resolveBodyForTitleIndex
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
  { id: "title-0", kind: "title", text: "标题A" },
  { id: "title-1", kind: "title", text: "标题B" },
  { id: "body-0", kind: "body", text: "正文A\n\n第二段" },
  { id: "body-1", kind: "body", text: "正文B" }
];

assert(resolveBodyForTitleIndex(blocks, 1)?.text === "正文B", "body by index");
assert(
  buildManuscriptFlowText({ title: "标题A", body: "行1\n\n行2" }) === "标题A 行1 行2",
  "flatten flow"
);

console.log("studioManuscriptView.test.ts: ok");
