import {
  studioComposeProgressLabel,
  studioComposerProgressLabel,
  studioStreamPhaseLabel
} from "../studioComposeProgress";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  studioStreamPhaseLabel({ runPhase: "正在检索资料…" }).includes("资料"),
  "material phase in stream"
);
assert(
  studioStreamPhaseLabel({ runPhase: "写稿中", hasStream: true }) === "正在输出成稿…",
  "stream output phase"
);
assert(studioComposerProgressLabel({ runPhase: "写稿中", hasStream: true }) === undefined, "composer hides when streaming");
assert(
  studioComposeProgressLabel({ runPhase: "写稿中", hasStream: true }) === "正在输出成稿…",
  "legacy alias"
);

console.log("studioComposeProgress.test.ts: ok");
