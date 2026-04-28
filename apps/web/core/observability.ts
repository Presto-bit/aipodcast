import { LogScope, appendLogEvent, shouldIngestForScope } from "../lib/logManagement";

type IngestClientLogParams = {
  scope: LogScope;
  requestId: string;
  traceId?: string;
  errorCode: string;
  level: "info" | "error";
  module: string;
  route?: string;
  release?: string;
  message: string;
  location?: string;
  payload?: Record<string, unknown>;
  logger?: "log" | "error";
};

/**
 * 统一客户端诊断事件写入：先检查 scope 开关/采样，再输出结构化日志并落地事件存储。
 */
export async function ingestClientLogEvent(params: IngestClientLogParams): Promise<boolean> {
  const allowed = await shouldIngestForScope(params.scope, params.requestId);
  if (!allowed) return false;
  const line = JSON.stringify({
    type: params.scope,
    ts: new Date().toISOString(),
    requestId: params.requestId,
    traceId: params.traceId || "",
    errorCode: params.errorCode,
    route: params.route || "",
    release: params.release || "",
    location: params.location || "",
    message: params.message,
    data: params.payload || {}
  });
  if (params.logger === "error") console.error(line);
  else console.log(line);
  await appendLogEvent({
    scope: params.scope,
    requestId: params.requestId,
    traceId: params.traceId,
    level: params.level,
    errorCode: params.errorCode,
    module: params.module,
    route: params.route,
    release: params.release,
    message: params.message,
    location: params.location,
    payload: params.payload
  });
  return true;
}
