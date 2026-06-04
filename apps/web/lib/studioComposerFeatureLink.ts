/** Studio → 对话页打开「我的特色」 */
export const OPEN_COMPOSER_FEATURE_KEY = "fym_open_composer_feature_v1";

export function markOpenComposerFeature(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(OPEN_COMPOSER_FEATURE_KEY, "1");
  } catch {
    // ignore
  }
}

export function consumeOpenComposerFeature(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = sessionStorage.getItem(OPEN_COMPOSER_FEATURE_KEY);
    if (v !== "1") return false;
    sessionStorage.removeItem(OPEN_COMPOSER_FEATURE_KEY);
    return true;
  } catch {
    return false;
  }
}
