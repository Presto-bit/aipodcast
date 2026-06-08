/** chip / 澄清补全后应强制走 compose（与 studioBriefMerge 对齐） */
const COMPOSE_CHIP_RE =
  /^(按已有信息|直接开始写成稿|(受众|卖点|场景|主题)[：:])/;

export function shouldForceStudioCompose(message: string, fromChip = false): boolean {
  const q = message.trim();
  if (!q) return false;
  if (fromChip) return true;
  return COMPOSE_CHIP_RE.test(q);
}
