import { studioComposeProgressLabel } from "../studioComposeProgress";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  studioComposeProgressLabel({ runPhase: "正在检索资料…" }).includes("检索"),
  "material phase"
);
assert(
  studioComposeProgressLabel({ runPhase: "写稿中", hasStream: true }) === "正在输出成稿…",
  "stream phase"
);

console.log("studioComposeProgress.test.ts: ok");
