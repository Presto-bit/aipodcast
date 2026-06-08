import { shouldForceStudioCompose } from "../studioComposeChip";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(shouldForceStudioCompose("受众：职场白领", true), "field chip from chip click");
assert(!shouldForceStudioCompose("开头钩子怎么写？", false), "ask only");

console.log("studioComposeChip.test.ts ok");
