/** 客户端改版 / 篇幅 / 编辑意图（仅显式信号；语义路由由后端 Planner 决定） */

import { userMessageLooksLikeQuestion } from "./studioAgentStructured";
import { buildBlockPatchOpinion } from "./studioBlockPatch";
import { isOpsStrategyQuestion } from "./studioOpsStrategy";

export const STUDIO_REVISE_INTENT_RE =
  /改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化|更.{0,6}体|小红书体|风格|语气|口吻|更像|口语|书面|网感|再.{0,4}一点|再.{0,4}一些/;

/** 篇幅 / 扩写约束（如「写500字」） */
export const STUDIO_LENGTH_CONSTRAINT_RE =
  /写\s*\d+\s*字|约?\s*\d+\s+字|到\s*\d+\s*字|字数|篇幅|扩写|写长|写短|写长点|写短点|太短|太长|精简|压缩|扩充|加长|缩短篇幅/;

/** 纯问句：有稿时仍走 reply，不改版 */
export function isExplicitAskWhileReady(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  if (isOpsStrategyQuestion(q)) return true;
  if (/[?？]$/.test(q)) return true;
  return /怎么|如何|为什么|为啥|是否|能不能|可以吗|什么|多少/.test(q);
}

/** 解读 / 总结类：有稿时走 reply，不改版 */
export const STUDIO_MANUSCRIPT_READ_RE =
  /总结|概括|要点|解读|分析|看看|讲讲|什么意思|怎么样|评价|点评|优缺点|说了什么|讲了什么/;

/** 有稿时是否应走改版（仅显式 edit 信号；无 len≤56 形态猜测） */
export function looksLikeManuscriptEditRequest(text: string, hasManuscript: boolean): boolean {
  if (!hasManuscript) return false;
  const q = text.trim();
  if (!q) return false;
  if (isExplicitAskWhileReady(q)) return false;
  if (isOpsStrategyQuestion(q)) return false;
  if (STUDIO_MANUSCRIPT_READ_RE.test(q) && !STUDIO_REVISE_INTENT_RE.test(q) && !STUDIO_LENGTH_CONSTRAINT_RE.test(q)) {
    return false;
  }
  if (STUDIO_REVISE_INTENT_RE.test(q) || STUDIO_LENGTH_CONSTRAINT_RE.test(q)) return true;
  if (q.startsWith("【块级改版】")) return true;
  return false;
}

export function looksLikeReviseRequest(text: string, hasManuscript: boolean): boolean {
  return looksLikeManuscriptEditRequest(text, hasManuscript);
}

export function isStyleReviseRequest(text: string): boolean {
  return /体|风格|语气|口吻|更像|小红书体|口语|书面|网感|犀利|模板/.test(text.trim());
}

/** 将「写500字」类输入包装为块级改版指令 */
export function buildLengthPatchOpinion(userText: string): string | null {
  const q = userText.trim();
  const numMatch = q.match(/(?:写|约|到)\s*(\d{2,4})\s*字/);
  if (numMatch) {
    const n = numMatch[1];
    return buildBlockPatchOpinion(
      `在现有正文基础上调整至约 ${n} 字；保留主题、结构与核心信息；仅修改 body 块`
    );
  }
  if (STUDIO_LENGTH_CONSTRAINT_RE.test(q)) {
    return buildBlockPatchOpinion(
      q.startsWith("【块级改版】") ? q : `${q}（在现有正文基础上修改，勿另起新篇；仅改 body 块）`
    );
  }
  return null;
}

export function wrapManuscriptEditOpinion(userText: string): string {
  const length = buildLengthPatchOpinion(userText);
  if (length) return length;
  const trimmed = userText.trim();
  if (trimmed.startsWith("【块级改版】")) return trimmed;
  return buildBlockPatchOpinion(trimmed);
}
