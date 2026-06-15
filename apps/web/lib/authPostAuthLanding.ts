import { consumePostAuthReturnTo } from "./authReturnTo";
import { WORKBENCH_DEFAULT_PATH, normalizePathname } from "./navPaths";

const POST_AUTH_WELCOME_KEY = "fym_post_auth_welcome_v1";

export type PostAuthWelcomeIntent = "notes" | "create_podcast" | "create_tts" | "create" | "podcast";

function welcomeIntentFromFullPath(fullPath: string): PostAuthWelcomeIntent | null {
  const raw = String(fullPath || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const qIdx = raw.indexOf("?");
  const pathname = normalizePathname(qIdx >= 0 ? raw.slice(0, qIdx) : raw);
  const search = qIdx >= 0 ? raw.slice(qIdx + 1) : "";
  const mode = new URLSearchParams(search).get("mode");

  if (pathname === "/notes" || pathname.startsWith("/notes/")) return "notes";
  if (pathname === "/create") {
    if (mode === "tts") return "create_tts";
    if (mode === "podcast") return "create_podcast";
    return "create";
  }
  if (pathname === "/podcast" || pathname.startsWith("/podcast/")) return "podcast";
  return null;
}

/** 注册/登录成功后记住来源，供落地页展示一次性欢迎提示。 */
export function rememberPostAuthWelcomeFromPath(fullPath: string): void {
  if (typeof window === "undefined") return;
  const intent = welcomeIntentFromFullPath(fullPath);
  if (!intent) return;
  try {
    window.sessionStorage.setItem(POST_AUTH_WELCOME_KEY, intent);
  } catch {
    // ignore
  }
}

export function consumePostAuthWelcomeIntent(): PostAuthWelcomeIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(POST_AUTH_WELCOME_KEY);
    window.sessionStorage.removeItem(POST_AUTH_WELCOME_KEY);
    if (!raw) return null;
    return raw as PostAuthWelcomeIntent;
  } catch {
    return null;
  }
}

export function welcomeMessageForIntent(intent: PostAuthWelcomeIntent): string {
  switch (intent) {
    case "notes":
      return "注册成功，可上传资料或一键创建示例笔记本。";
    case "create_podcast":
      return "注册成功，可继续生成播客或复用模板参数。";
    case "create_tts":
      return "注册成功，可继续语音合成。";
    case "create":
      return "注册成功，可继续创作。";
    case "podcast":
      return "注册成功，可继续播客工作室操作。";
  }
}

/** 解析 returnTo（query + sessionStorage）并记录落地欢迎意图。 */
export function resolveAndRememberPostAuthDestination(rawFromQuery?: string | null): string {
  const target = consumePostAuthReturnTo(rawFromQuery) || WORKBENCH_DEFAULT_PATH;
  rememberPostAuthWelcomeFromPath(target);
  return target;
}
