import { normalizePathname } from "./navPaths";

export type PostAuthReturnToContext = {
  headline: string;
  /** 不含「注册/登录后」前缀的中性说明 */
  detail: string;
};

function parseReturnToPath(returnTo: string | null | undefined): { pathname: string; search: string } | null {
  const raw = String(returnTo || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const qIdx = raw.indexOf("?");
  const pathname = normalizePathname(qIdx >= 0 ? raw.slice(0, qIdx) : raw);
  const search = qIdx >= 0 ? raw.slice(qIdx) : "";
  return { pathname, search };
}

/** 根据 returnTo 生成登录/注册页的「你刚才在做什么」文案。 */
export function describePostAuthReturnTo(returnTo: string | null | undefined): PostAuthReturnToContext | null {
  const parsed = parseReturnToPath(returnTo);
  if (!parsed) return null;
  const { pathname, search } = parsed;
  const mode = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("mode");

  if (pathname === "/create") {
    if (mode === "tts") {
      return {
        headline: "你刚才在准备语音合成",
        detail: "将回到语音合成页，继续编辑文稿并生成音频。"
      };
    }
    if (mode === "podcast") {
      return {
        headline: "你刚才在准备生成播客",
        detail: "将回到创作页，继续编辑内容、试听模板或开始生成。"
      };
    }
    return {
      headline: "你刚才在创作页",
      detail: "将回到创作页继续操作。"
    };
  }

  if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    return {
      headline: "你刚才在管理资料",
      detail: "将回到资料页，可上传文档、向资料提问并生成内容。"
    };
  }

  if (pathname === "/podcast" || pathname.startsWith("/podcast/")) {
    return {
      headline: "你刚才在播客工作室",
      detail: "将回到播客页继续配置与生成。"
    };
  }

  if (pathname === "/works" || pathname.startsWith("/works/")) {
    return {
      headline: "你刚才在查看作品",
      detail: "将回到作品页继续浏览或管理。"
    };
  }

  if (pathname === "/subscription" || pathname.startsWith("/subscription/")) {
    return {
      headline: "你刚才在查看套餐与余额",
      detail: "将回到套餐页继续了解或充值。"
    };
  }

  return {
    headline: "你刚才在使用工作台",
    detail: "将回到离开前的页面继续操作。"
  };
}

export function buildLoginHref(returnTo: string | null | undefined): string {
  const raw = String(returnTo || "").trim();
  if (!raw) return "/login";
  return `/login?returnTo=${encodeURIComponent(raw)}`;
}

export function buildRegisterHref(returnTo: string | null | undefined): string {
  const raw = String(returnTo || "").trim();
  if (!raw) return "/register";
  return `/register?returnTo=${encodeURIComponent(raw)}`;
}
