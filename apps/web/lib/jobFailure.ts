export type FailureKind = "network" | "upstream" | "quota" | "validation" | "unknown";

export function classifyJobError(msg: string | null | undefined): FailureKind {
  const m = String(msg || "").toLowerCase();
  if (!m.trim()) return "unknown";
  if (/timeout|econn|connection|network|timed out|reset|enotfound|socket/.test(m)) return "network";
  if (/429|quota|rate|limit|余额|额度|频控|钱包|充值|不足|按次|套餐内|分钟包/.test(m)) return "quota";
  if (/400|invalid|参数|validation|格式|过大|超长/.test(m)) return "validation";
  if (/upstream|502|503|504|minimax|api|5\d\d/.test(m)) return "upstream";
  return "unknown";
}

const COPY: Record<FailureKind, { title: string; hint: string }> = {
  network: {
    title: "网络不太稳定",
    hint: "请检查网络或稍后重试；若一直如此，请联系客服并附上本页的记录编号。"
  },
  upstream: {
    title: "AI 服务暂时繁忙",
    hint: "可能是服务端繁忙或暂时中断，请隔几分钟再试；多次失败请联系客服。"
  },
  quota: {
    title: "用量、配额或钱包余额不足",
    hint: "可前往会员页查看套餐、分钟包与账户余额；「充值余额」在会员页下方，充值或升级后再试。"
  },
  validation: {
    title: "内容或设置需要调整",
    hint: "请检查字数、文件格式以及所选声音/模板等设置，修改后重试。"
  },
  unknown: {
    title: "出现未知问题",
    hint: "请复制下方追踪编号或完整提示，通过邮件联系客服，我们会帮你查。"
  }
};

export function failureCopy(kind: FailureKind): { title: string; hint: string } {
  return COPY[kind] || COPY.unknown;
}

/** 失败态常用恢复入口（与 classifyJobError 分类对齐） */
export function failureRecoveryLink(kind: FailureKind): { href: string; label: string } | null {
  if (kind === "quota") return { href: "/me/subscription", label: "我的订阅与余额" };
  return null;
}
