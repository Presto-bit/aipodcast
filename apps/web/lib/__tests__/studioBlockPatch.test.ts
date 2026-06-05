import { buildBlockPatchOpinion } from "../studioBlockPatch";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const wrapped = buildBlockPatchOpinion("请把语气改得更犀利");
assert(wrapped.startsWith("【块级改版】"), "should add block patch prefix");
assert(wrapped.includes("更犀利"), "should keep user opinion");

const idempotent = buildBlockPatchOpinion(wrapped);
assert(idempotent === wrapped, "should not double-wrap");

console.log("studioBlockPatch.test.ts: ok");
