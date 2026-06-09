/** 客户端改版意图识别（风格 / 语气 / 局部） */

export const STUDIO_REVISE_INTENT_RE =
  /改版|改一下|改标题|改正文|缩短|加长|重写|重新写|更犀利|别动正文|只改|润色|优化|更.{0,6}体|小红书体|风格|语气|口吻|更像|口语|书面|网感|再.{0,4}一点|再.{0,4}一些/;

export function looksLikeReviseRequest(text: string, hasManuscript: boolean): boolean {
  if (!hasManuscript) return false;
  return STUDIO_REVISE_INTENT_RE.test(text.trim());
}

/** 风格/语气类改版：探索模式也展示 diff，不 silent auto-apply */
export function isStyleReviseRequest(text: string): boolean {
  return /体|风格|语气|口吻|更像|小红书|口语|书面|网感|犀利|模板/.test(text.trim());
}
