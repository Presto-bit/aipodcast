const fs = require("fs");
const path = require("path");

/**
 * Next 默认只加载 apps/web 下的 .env*；仓库常在根目录维护 `.env.ai-native`。
 * 在构建/启动时补齐未在环境中声明的键，避免 BFF 与 shell 手测环境不一致。
 *
 * `INTERNAL_SIGNING_SECRET` 必须与编排器（读根目录 `.env.ai-native`）一致，否则 BFF 请求会 401
 * `invalid_internal_signature`。Next 会先加载 apps/web/.env.local，易误留占位值，故该键在根文件存在时
 * 始终以根文件覆盖。
 */
const OVERRIDE_FROM_ROOT_ENV_KEYS = new Set(["INTERNAL_SIGNING_SECRET"]);

function mergeRootAiNativeEnv() {
  const rootEnvPath = path.resolve(__dirname, "../../.env.ai-native");
  if (!fs.existsSync(rootEnvPath)) return;
  const text = fs.readFileSync(rootEnvPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const raw = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    let val = raw.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (OVERRIDE_FROM_ROOT_ENV_KEYS.has(key)) {
      process.env[key] = val;
      continue;
    }
    const cur = process.env[key];
    if (cur === undefined || cur === "") {
      process.env[key] = val;
    }
  }
}

mergeRootAiNativeEnv();

/** 与 `middleware.ts` 中 `CACHE_PAGE` 一致：避免 HTML/RSC 被 CDN 按 Next 默认整页缓存（如 s-maxage=31536000）。 */
const CACHE_DOCUMENT =
  "private, no-cache, no-store, max-age=0, must-revalidate";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: CACHE_DOCUMENT },
          { key: "Pragma", value: "no-cache" }
        ]
      }
    ];
  },
  experimental: {
    /** 启用 `instrumentation.ts`（生产 INTERNAL_SIGNING_SECRET 强校验等） */
    instrumentationHook: true,
    typedRoutes: false,
    /** 按需解析子路径，减轻首包与路由切换时的解析开销 */
    optimizePackageImports: ["@tanstack/react-query", "react-markdown"],
    /**
     * Server Actions 体积极限；Route Handler（如 /api/note-upload）在部分部署下另有默认上限。
     * 大文件 multipart 若 413：请同步调大反代 `client_max_body_size` 与平台请求体限制。
     */
    serverActions: {
      bodySizeLimit: "25mb"
    }
  }
};

module.exports = nextConfig;
