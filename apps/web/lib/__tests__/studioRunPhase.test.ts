import { normalizeStudioRunPhase } from "../studioRunPhase";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeStudioRunPhase("云端排队中…") === undefined, "hide queue");
assert(normalizeStudioRunPhase("正在检索资料…") === "检索资料…", "rag phase");
assert(normalizeStudioRunPhase("正在生成内容成品…") === "撰写正文…", "writing phase");
assert(normalizeStudioRunPhase("初稿偏模板化，正在重写…") === "优化文稿…", "retry phase");

console.log("studioRunPhase.test.ts: ok");
