/**
 * 知识库问答 BFF（/api/notes/ask*）可选直连「不经 CDN」的源站域名。
 *
 * 部署：DNS 将例如 `origin-www.example.com` A/AAAA 到 ECS（勿 CNAME 到阿里云 CDN），
 * 该主机上跑同一套 Next + Nginx；浏览器页面仍在 `www`（走 CDN），仅问答 fetch 指向 `origin-www`。
 *
 * 会话 Cookie 须带 `Domain=.example.com`（环境变量 `COOKIE_DOMAIN`），否则子域收不到 `fym_session`。
 * 跨子域时 CORS 见 `NEXT_PUBLIC_NOTES_ASK_CORS_ORIGINS` 与 `middleware.ts`。
 */
export function notesAskBffBase(): string {
  return (process.env.NEXT_PUBLIC_NOTES_ASK_BFF_ORIGIN || "").trim().replace(/\/$/, "");
}

/** @param path 须以 `/api/notes/ask` 开头 */
export function notesAskBffUrl(path: string): string {
  const base = notesAskBffBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  return `${base}${p}`;
}

/** 指向独立源站域名时用 include 以携带 Cookie；同源相对路径用 same-origin */
export function notesAskFetchCredentials(): RequestCredentials {
  return notesAskBffBase() ? "include" : "same-origin";
}
