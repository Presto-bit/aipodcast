import { mergeBriefChipReply } from "../studioBriefMerge";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = "我想写一篇清单体内容";
assert(
  mergeBriefChipReply(base, "受众：产品新人").includes("产品新人"),
  "field chip merges audience"
);
assert(
  mergeBriefChipReply(base, "受众：产品新人").includes("清单体"),
  "field chip keeps prior brief"
);
assert(
  mergeBriefChipReply(base, "再试一次").startsWith("我想写"),
  "write intent injected"
);
assert(
  mergeBriefChipReply("", "给产品新人，清单体讲 3 个避坑").includes("产品新人"),
  "empty base uses chip"
);

console.log("studioBriefMerge.test.ts: ok");
