import {
  buildStudioBriefClarifyTurn,
  buildStudioRewriteClarifyTurn,
  STUDIO_COMPOSE_RETRY_CHIP
} from "../studioBriefClarify";
import { classifyComposeSoftFailure } from "../studioComposeFailure";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const promoBrief =
  "写一篇小红书推广产品，面向职场女性，提醒喝水的水杯，真实痛点，爆款潜质";

const briefTurn = buildStudioBriefClarifyTurn("template", promoBrief, promoBrief);
assert(briefTurn.suggestedReplies.includes(STUDIO_COMPOSE_RETRY_CHIP), "retry chip on promo");
assert(
  !briefTurn.suggestedReplies.some((c) => /产品新人.*清单体/.test(c)),
  "no irrelevant listicle chip for promo"
);

const rewriteTurn = buildStudioRewriteClarifyTurn(promoBrief, promoBrief);
assert(rewriteTurn.content.includes("偏模板"), "rewrite explains quality not brief");
assert(rewriteTurn.suggestedReplies[0] === STUDIO_COMPOSE_RETRY_CHIP, "retry first");

assert(
  classifyComposeSoftFailure("NEEDS_REWRITE", promoBrief) === "needs_rewrite",
  "NEEDS_REWRITE code"
);
assert(
  classifyComposeSoftFailure("NEEDS_BRIEF", "帮我想想") === "needs_brief",
  "NEEDS_BRIEF code"
);
assert(
  classifyComposeSoftFailure("成稿像是通用模板", promoBrief) === "needs_rewrite",
  "template + sufficient brief"
);

console.log("studioBriefClarify.test.ts: ok");
