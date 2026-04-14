/**
 * 将当前路径映射到 pageTourContent 中的 tourId；未命中则无引导。
 */

const EXACT: Record<string, string> = {
  "/": "home",
  "/notes": "notes",
  "/create": "create",
  "/works": "works",
  "/subscription": "subscription",
  "/voice": "voice",
  "/podcast": "podcast",
  "/tts": "tts",
  "/drafts": "drafts",
  "/jobs": "jobs",
  "/help": "help",
  "/me": "me"
};

export function normalizePathname(pathname: string): string {
  const raw = (pathname || "").split("?")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

export function tourIdForPathname(pathname: string): string | null {
  const p = normalizePathname(pathname);
  if (p.startsWith("/admin")) return null;
  if (EXACT[p]) return EXACT[p];
  if (p.startsWith("/notes") && !p.startsWith("/notes/trash") && !p.startsWith("/notes/templates")) {
    return "notes";
  }
  if (p.startsWith("/me")) return "me";
  return null;
}
