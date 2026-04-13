/** 客服邮件（需在部署环境配置 NEXT_PUBLIC_SUPPORT_EMAIL） */
export function supportMailtoWithJob(jobId: string): string {
  const email = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim() || "support@example.com";
  const sub = encodeURIComponent(`[创作记录 ${jobId.slice(0, 8)}…] 需要帮助`);
  const body = encodeURIComponent(
    `记录编号（完整）：${jobId}\n\n问题描述：\n\n（请勿删除上方编号，便于我们为你排查）\n`
  );
  return `mailto:${email}?subject=${sub}&body=${body}`;
}
