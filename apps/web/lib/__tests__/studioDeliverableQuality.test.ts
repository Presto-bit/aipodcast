import {
  deliverableBodyLooksLikeIntakeEcho,
  shouldRejectDeliverableBody
} from "../studioDeliverableQuality";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(shouldRejectDeliverableBody("compose", ""), "empty compose should reject");
assert(
  shouldRejectDeliverableBody("compose", "📌 先说结论\n💡 展开\n✅ 最后"),
  "template compose should reject"
);
assert(
  deliverableBodyLooksLikeIntakeEcho("📌 先说结论\n💡 展开\n✅ 最后"),
  "template markers detected"
);
assert(
  !shouldRejectDeliverableBody("revise", "📌 先说结论\n💡 展开\n✅ 最后"),
  "revise should skip template heuristic"
);

console.log("studioDeliverableQuality.test.ts: ok");
