/** 营销站根 URL（PrestoAI 品牌外链）；未配置时与 RSS 公网默认一致 */
export function marketingSiteUrl(): string {
  const u = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim()) || "";
  return u || "https://prestoai.cn";
}
