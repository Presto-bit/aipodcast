import { isOpsStrategyQuestion, opsStrategyFallbackReply } from "../studioOpsStrategy";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isOpsStrategyQuestion("给我运营方案，什么时候发，怎么推"), "ops detect");
const reply = opsStrategyFallbackReply("什么时候发，怎么推");
assert(!/画布|稿件的主题/.test(reply), "no canvas wording");
assert(/通用框架|发布时间|怎么推/.test(reply), "actionable sections");
assert(!/喝水打卡|效率工具/.test(reply), "no polluted generic tips");

console.log("studioOpsStrategy.test.ts: ok");
