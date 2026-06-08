import { xhsBodyDisplayParagraphs } from "../xhsBodyFormat";
import { splitXhsBodyParagraphs } from "../studioManuscriptView";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const longPara =
  "开完三个会才想起今天一口水没喝。脸干、头沉、下午效率直接腰斩。工位姐妹是不是也这样？";

const split = xhsBodyDisplayParagraphs(longPara);
assert(split.length >= 2, "long single paragraph should split for readability");

const viaView = splitXhsBodyParagraphs(`第一段。\n\n第二段。`);
assert(viaView.length === 2, "explicit blank lines preserved");

console.log("xhsBodyFormat.test.ts: ok");
