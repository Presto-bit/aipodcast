/**
 * Next Server 启动时跑一次；与 `next.config.js` 中 `experimental.instrumentationHook` 配合。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionInternalSigningSecretOrExit } = await import("./lib/productionSigningSecret");
  assertProductionInternalSigningSecretOrExit();
}
