/**
 * 与编排器 `startup_security.assert_production_security_or_exit` 对齐：
 * 生产环境禁止使用弱默认或短于 32 字节的 INTERNAL_SIGNING_SECRET。
 */

const WEAK_INTERNAL_SECRETS = new Set(
  ["", "local-internal-secret", "changeme", "secret", "test"].map((s) => s.toLowerCase())
);

function signingSecretIsAcceptableForProduction(raw: string): boolean {
  const secret = raw.trim();
  if (secret.length < 32) return false;
  if (WEAK_INTERNAL_SECRETS.has(secret.toLowerCase())) return false;
  return true;
}

/** 在 instrumentation 中调用：生产环境密钥无效时终止进程 */
export function assertProductionInternalSigningSecretOrExit(): void {
  if (process.env.NODE_ENV !== "production") return;
  // `next build` 也会执行 instrumentation；此处跳过，避免 CI/无 .env 时构建失败。运行 `next start` 无该 phase，仍会校验。
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const s = process.env.INTERNAL_SIGNING_SECRET || "";
  if (!signingSecretIsAcceptableForProduction(s)) {
    console.error(
      "[presto-security] NODE_ENV=production 要求 INTERNAL_SIGNING_SECRET 为至少 32 字节的强随机串，" +
        "且不能使用 local-internal-secret 等示例值（须与编排器 FYV_PRODUCTION 校验一致）。"
    );
    process.exit(1);
  }
}
