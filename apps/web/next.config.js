const fs = require("fs");
const path = require("path");

/**
 * Next 默认只加载 apps/web 下的 .env*；仓库常在根目录维护 `.env.ai-native`。
 * 在构建/启动时补齐未在环境中声明的键，避免 BFF 与 shell 手测环境不一致。
 */
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
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

mergeRootAiNativeEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false
  }
};

module.exports = nextConfig;
