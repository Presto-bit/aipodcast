export type StudioReviseTier = "preserve" | "rephrase" | "rewrite";

export const STUDIO_REVISE_TIERS: StudioReviseTier[] = ["preserve", "rephrase", "rewrite"];

export function studioReviseTierLabel(tier: StudioReviseTier): string {
  switch (tier) {
    case "preserve":
      return "保守";
    case "rewrite":
      return "强力";
    default:
      return "标准";
  }
}

export function normalizeStudioReviseTier(raw: unknown): StudioReviseTier {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "preserve" || t === "rewrite") return t;
  return "rephrase";
}
