import {
  composeTaskSentenceFromTurns,
  isAskOnlyUserTurn
} from "../studioWorkTask";
import type { StudioAgentTurn } from "../studioWorkTypes";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isAskOnlyUserTurn("开头钩子怎么写更抓人"), "hook question is ask-only");
assert(!isAskOnlyUserTurn("我想创作小红书，推广杯子，主打职场女性，提醒喝水"), "promo brief is not ask-only");

const turns: StudioAgentTurn[] = [
  { id: "u1", role: "user", content: "开头钩子怎么写更抓人", createdAt: 1 },
  {
    id: "u2",
    role: "user",
    content: "我想创作小红书，推广杯子，主打职场女性，提醒喝水",
    createdAt: 2
  }
];

const composeTask = composeTaskSentenceFromTurns(turns, turns[1]!.content);
assert(!composeTask.includes("开头钩子"), "compose task should drop ask-only turn");
assert(composeTask.includes("推广杯子"), "compose task should keep promo brief");

console.log("studioWorkTask.test.ts: ok");
