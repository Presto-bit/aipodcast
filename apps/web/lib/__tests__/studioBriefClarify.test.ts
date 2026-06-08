import { buildStudioBriefClarifyTurn } from "../studioBriefClarify";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const turn = buildStudioBriefClarifyTurn("template", "成稿像是通用模板");
assert(turn.content.includes("偏泛"), "gentle template clarify");
assert(turn.suggestedReplies.length >= 2, "has chips");
assert(!turn.content.includes("validation_failed"), "no raw error");

const listTurn = buildStudioBriefClarifyTurn("empty", "我想写清单体");
assert(listTurn.suggestedReplies.some((c) => /产品新人|清单/.test(c)), "listicle chips");

console.log("studioBriefClarify.test.ts: ok");
