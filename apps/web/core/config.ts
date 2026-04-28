/**
 * Core/Config: 集中管理服务端运行时配置，避免各路由散落读取环境变量。
 */

export type AppEnv = "development" | "staging" | "production";

function readEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function toAppEnv(raw: string): AppEnv {
  const v = raw.toLowerCase();
  if (v === "production" || v === "prod") return "production";
  if (v === "staging" || v === "stage" || v === "pre") return "staging";
  return "development";
}

function toPositiveInt(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export const APP_ENV: AppEnv = toAppEnv(readEnv("APP_ENV") || readEnv("NODE_ENV"));

export const APP_RELEASE: string = (() => {
  const raw = readEnv("VERCEL_GIT_COMMIT_SHA") || readEnv("APP_VERSION") || "dev";
  return raw.slice(0, 48);
})();

export const LOG_MANAGEMENT_TTL_MAX_MINUTES = toPositiveInt(readEnv("LOG_MANAGEMENT_TTL_MAX_MINUTES"), 24 * 60);

export const NOTEBOOK_SHARE_SERVER_DIAGNOSTICS_ENABLED = readEnv("NOTEBOOK_SHARE_SERVER_DIAGNOSTICS") !== "0";
