import crypto from "crypto";
import type { IncomingHttpHeaders } from "http";
import type { NextRequest } from "next/server";
import { ingestLogEvent } from "../core/observability";
import { resolveOrchestratorBaseUrl } from "./orchestratorBase";

/** HttpOnly 会话 Cookie，BFF 读取后转发为 Authorization: Bearer（与编排器会话 token 一致） */
export const SESSION_COOKIE_NAME = "fym_session";

/** 编排器可能因 SMTP / PG 慢查询 / 冷启动较慢；显式使用该常量的 BFF 与默认 fetch 超时共用 */
export const ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS = 120_000;

/** 未传 `timeoutMs` 时的 BFF→编排器等待上限；可由环境变量覆盖（毫秒，1000～600000） */
function defaultFetchOrchestratorTimeoutMs(): number {
  const raw = (process.env.ORCHESTRATOR_FETCH_DEFAULT_TIMEOUT_MS || "").trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1000) return Math.min(n, 600_000);
  }
  return ORCHESTRATOR_TIMEOUT_SLOW_UPSTREAM_MS;
}

const DEFAULT_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function sessionMaxAgeSec(): number {
  const raw = process.env.SESSION_COOKIE_MAX_AGE_SEC;
  if (!raw) return DEFAULT_SESSION_MAX_AGE_SEC;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 60 ? n : DEFAULT_SESSION_MAX_AGE_SEC;
}

function cookieSecureFlag(): boolean {
  if (process.env.COOKIE_SECURE === "0") return false;
  if (process.env.COOKIE_SECURE === "1") {
    // 本地 next dev 多为 http://；Secure 会话 Cookie 不会被浏览器保存，登录态会丢
    if (process.env.NODE_ENV !== "production") return false;
    return true;
  }
  return process.env.NODE_ENV === "production";
}

function cookieSameSite(): "lax" | "strict" | "none" {
  const v = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  if (v === "strict" || v === "none") return v;
  return "lax";
}

/**
 * 登录/注册成功后由 Route Handler 写入；浏览器同源请求自动携带，无需 JS 可读 token。
 */
export function buildSessionSetCookieHeader(token: string): string {
  const t = String(token || "").trim();
  if (!t) return "";
  const maxAge = sessionMaxAgeSec();
  const sameSite = cookieSameSite();
  const secure = cookieSecureFlag() || sameSite === "none";
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(t)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`
  ];
  if (secure) parts.push("Secure");
  const domain = (process.env.COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/** 登出时清除会话 Cookie */
export function buildSessionClearCookieHeader(): string {
  const sameSite = cookieSameSite();
  const secure = cookieSecureFlag() || sameSite === "none";
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`
  ];
  if (secure) parts.push("Secure");
  const domain = (process.env.COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function getInternalSigningSecret(): string {
  return process.env.INTERNAL_SIGNING_SECRET || "local-internal-secret";
}

let warnedWeakProductionSecret = false;

function maybeWarnWeakProductionSecret(): void {
  if (warnedWeakProductionSecret) return;
  warnedWeakProductionSecret = true;
  if (process.env.NODE_ENV !== "production") return;
  const s = getInternalSigningSecret();
  if (s.length < 32 || s === "local-internal-secret") {
    console.error(
      "[presto-security] INTERNAL_SIGNING_SECRET 在生产环境无效或过弱：必须配置至少 32 字节的随机串，并与编排器 FYV_PRODUCTION 校验一致；否则 BFF 与编排器内部签名可被伪造。"
    );
  }
}

/** BFF 与浏览器、`X-Request-ID` 透传编排器。 */
export function getOrCreateRequestId(req: NextRequest): string {
  const incoming = (req.headers.get("x-request-id") || req.headers.get("x-correlation-id") || "").trim();
  return incoming || crypto.randomUUID();
}

export function orchestratorUrl(path: string): string {
  const base = resolveOrchestratorBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * 内部签名：对 UTF-8 字符串或原始字节（如二进制上传）做 SHA256 后与时间戳一起 HMAC。
 */
export function buildInternalHeaders(payload: string | Buffer) {
  maybeWarnWeakProductionSecret();
  const signingSecret = getInternalSigningSecret();
  const timestamp = String(Date.now());
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const payloadSha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestamp}:${payloadSha256}`, "utf8")
    .digest("hex");
  return {
    "x-internal-timestamp": timestamp,
    "x-internal-payload-sha256": payloadSha256,
    "x-internal-signature": signature
  };
}

type ProxyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type FetchOrchestratorOptions = {
  method?: ProxyMethod;
  /** 参与内部签名的负载；默认 "{}" */
  payload?: string;
  /**
   * HTTP 请求体。与 `payload` 分离：未传 `body` 时用 `payload` 作为请求体并参与签名。
   * 传 `Buffer` 时按原始字节签名（二进制上传编排器）。
   * 传 `null` 表示不发送 body（如部分 DELETE / 无 body 的 POST）。
   */
  body?: string | Buffer | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 透传编排器 X-Request-ID（便于日志关联） */
  requestId?: string;
  /** GET 失败时是否再试一次（SSE 等长连接须为 false） */
  retryGetOnce?: boolean;
  /** Server-Sent Events：不设 Abort 超时，避免切断长连接 */
  sse?: boolean;
  /** 长流式 GET（如同源 MP3）：不设读超时；且关闭 GET 自动重试（避免重复 Range/浪费带宽） */
  longLivedGet?: boolean;
  /** 上游 2xx 且为二进制成功时，可强制 HTTP 状态（如 artifact 下载固定 200） */
  forceBinarySuccessStatus?: number;
  cache?: RequestCache;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `req.cookies` 偶发为空时回退解析原始 Cookie 头。 */
function sessionTokenFromCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const needle = `${SESSION_COOKIE_NAME}=`;
  const parts = cookieHeader.split(";").map((s) => s.trim());
  for (const p of parts) {
    if (p.startsWith(needle)) {
      const raw = p.slice(needle.length);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

/**
 * 将浏览器请求上的会话透传给编排器：优先 Authorization，其次 HttpOnly Cookie（`SESSION_COOKIE_NAME`）。
 */
export function incomingAuthHeadersFrom(req: NextRequest): Record<string, string> {
  const auth = (req.headers.get("authorization") || "").trim();
  if (auth) return { authorization: auth };
  let fromCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (!fromCookie) {
    fromCookie = sessionTokenFromCookieHeader(req.headers.get("cookie"))?.trim();
  }
  if (fromCookie) return { authorization: `Bearer ${fromCookie}` };
  return {};
}

/**
 * Pages Router / Node `IncomingMessage` 侧与会话转发（用于 multipart 等不走 `NextRequest` 的路径）。
 */
export function incomingAuthHeadersFromNodeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const authRaw = headers.authorization;
  const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
  const authStr = typeof auth === "string" ? auth.trim() : "";
  if (authStr) return { authorization: authStr };
  const cookieRaw = headers.cookie;
  const cookieHeader = Array.isArray(cookieRaw) ? cookieRaw.join("; ") : cookieRaw ?? "";
  const fromCookie = sessionTokenFromCookieHeader(cookieHeader || null)?.trim();
  if (fromCookie) return { authorization: `Bearer ${fromCookie}` };
  return {};
}

/**
 * 统一编排器请求：默认超时 + GET 单次重试，降低瞬时抖动导致的接口失败。
 */
export async function fetchOrchestrator(path: string, opts: FetchOrchestratorOptions = {}): Promise<Response> {
  const method = opts.method || "GET";
  const defaultPayload = opts.payload ?? "{}";
  const sse = opts.sse === true;
  const longLived = opts.longLivedGet === true;
  const timeoutMs = sse || longLived ? 0 : Math.max(1000, opts.timeoutMs ?? defaultFetchOrchestratorTimeoutMs());
  const maxAttempts =
    method === "GET" && opts.retryGetOnce !== false && !sse && !longLived ? 2 : 1;

  const bodyForFetch =
    method === "GET" ? undefined : opts.body === null ? undefined : opts.body !== undefined ? opts.body : defaultPayload;

  const signingMaterial: Buffer =
    bodyForFetch === undefined
      ? Buffer.from(defaultPayload, "utf8")
      : Buffer.isBuffer(bodyForFetch)
        ? bodyForFetch
        : Buffer.from(String(bodyForFetch), "utf8");

  const headers: Record<string, string> = {
    ...buildInternalHeaders(signingMaterial),
    ...(opts.headers || {})
  };
  const rid = (opts.requestId || "").trim();
  if (rid) headers["x-request-id"] = rid;
  let lastError: unknown;

  const bodyInit: BodyInit | undefined =
    bodyForFetch === undefined
      ? undefined
      : Buffer.isBuffer(bodyForFetch)
        ? new Uint8Array(bodyForFetch)
        : bodyForFetch;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const upstream = await fetch(orchestratorUrl(path), {
        method,
        headers,
        body: bodyInit,
        cache: opts.cache ?? "no-store",
        signal: sse || longLived ? undefined : AbortSignal.timeout(timeoutMs)
      });
      if (!upstream.ok) {
        const statusCode = upstream.status;
        const upstreamRid = (upstream.headers.get("x-request-id") || rid).trim();
        await ingestServerErrorEvent({
          scope: "orchestrator_api_error",
          requestId: upstreamRid,
          route: path,
          errorCode: `HTTP_${statusCode}`,
          message: `Upstream returned ${statusCode} for ${method} ${path}`,
          payload: { method, status: statusCode, path, attempt }
        });
      }
      return upstream;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      await sleep(180 * attempt);
    }
  }

  const e = new Error("upstream_unreachable");
  (e as { cause?: unknown }).cause = lastError;
  await ingestServerErrorEvent({
    scope: "orchestrator_api_error",
    requestId: rid,
    route: path,
    errorCode: "UPSTREAM_UNREACHABLE",
    message: describeOrchestratorUnreachable(lastError).slice(0, 600),
    payload: { method, path }
  });
  throw e;
}

/** 编排器不可达时的排障提示（Docker 服务名 orchestrator 在宿主机上无法解析） */
function orchestratorReachabilityHint(base: string): string {
  const b = (base || "").trim().replace(/\/+$/, "") || "(未配置)";
  try {
    const host = new URL(b.startsWith("http") ? b : `http://${b}`).hostname;
    if (host === "orchestrator") {
      return `请在 Web 容器内探测：docker compose -f docker-compose.ai-native.yml --env-file .env.ai-native exec web wget -qO- ${b}/health；并查看编排器日志：docker compose ... logs orchestrator --tail=200。宿主机上直接 curl http://orchestrator:8008 会失败（无法解析服务名）。`;
    }
  } catch {
    // ignore
  }
  if (/127\.0\.0\.1|localhost/i.test(b)) {
    return `本机可执行 curl ${b}/health。`;
  }
  return `可请求 ${b}/health 检查上游是否存活。`;
}

/**
 * fetchOrchestrator 失败时抛出的 Error.message 固定为 upstream_unreachable，真实原因在 error.cause。
 * 用于 BFF 返回可读的中文说明。
 */
export function describeOrchestratorUnreachable(err: unknown): string {
  const base = resolveOrchestratorBaseUrl();
  const hint = orchestratorReachabilityHint(base);
  let inner: unknown = err;
  if (inner instanceof Error && inner.message === "upstream_unreachable" && inner.cause != null) {
    inner = inner.cause;
  }
  let text = "";
  if (inner instanceof Error) {
    text = [inner.name && inner.name !== "Error" ? inner.name : "", inner.message || ""].filter(Boolean).join(": ");
  } else if (typeof inner === "string") {
    text = inner;
  } else if (inner != null && typeof inner === "object" && "message" in inner) {
    text = String((inner as { message: unknown }).message);
  } else if (inner != null) {
    text = String(inner);
  }
  text = text.trim();
  const lower = text.toLowerCase();

  if (inner instanceof Error && inner.name === "AbortError") {
    return `连接编排器超时或中断。${hint} 若涉及发验证码/邮件，请检查 SMTP 与编排器负载。ORCHESTRATOR_URL 当前为 ${base}。`;
  }
  if (/aborted|timeout/i.test(lower)) {
    return `连接编排器超时或中断。${hint} 若涉及发验证码/邮件，请检查 SMTP 与编排器负载。ORCHESTRATOR_URL 当前为 ${base}。`;
  }
  if (/econnrefused|enotfound|econnreset|fetch failed|socket|network|aggregateerror/i.test(lower)) {
    return `无法连上编排器（${text || "网络错误"}）。${hint} 请确认 orchestrator 容器为 running、与 web 同属 compose 网络。ORCHESTRATOR_URL 当前为 ${base}。`;
  }
  if (text) {
    return `无法连接编排器：${text}（当前 ${base}）`;
  }
  return `无法连接编排器。${hint} ORCHESTRATOR_URL 当前为 ${base}。`;
}

function requestIdFields(rid: string): Record<string, string> | Record<string, never> {
  const r = String(rid || "").trim();
  if (!r) return {};
  return { requestId: r, request_id: r };
}

async function ingestServerErrorEvent(params: {
  scope: "bff_api_error" | "orchestrator_api_error";
  requestId: string;
  route: string;
  errorCode: string;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const requestId = String(params.requestId || "").trim();
  if (!requestId) return;
  try {
    await ingestLogEvent({
      scope: params.scope,
      requestId,
      level: "error",
      errorCode: params.errorCode,
      module: params.scope === "bff_api_error" ? "bff" : "orchestrator",
      route: params.route,
      message: params.message,
      payload: params.payload || {},
      logger: "error"
    });
  } catch {
    // ignore log-ingest failures
  }
}

export async function proxyJsonFromOrchestrator(path: string, opts: FetchOrchestratorOptions = {}): Promise<Response> {
  try {
    const upstream = await fetchOrchestrator(path, opts);
    const text = await upstream.text();
    const outboundRid =
      (upstream.headers.get("x-request-id") || opts.requestId || "").trim() || "";
    const ridHeaders: Record<string, string> = {};
    if (outboundRid) ridHeaders["x-request-id"] = outboundRid;
    const trimmed = text.trim();
    if (!upstream.ok && (!trimmed || trimmed === "{}")) {
      return Response.json(
        {
          success: false,
          error: "upstream_error_empty_body",
          detail: `上游返回 ${upstream.status} 且错误体为空（path=${path}）`,
          status: upstream.status,
          ...requestIdFields(outboundRid || opts.requestId || "")
        },
        {
          status: upstream.status,
          ...(outboundRid ? { headers: { "x-request-id": outboundRid } } : {})
        }
      );
    }
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", ...ridHeaders }
    });
  } catch (err) {
    const rid = (opts.requestId || "").trim();
    return Response.json(
      {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(err),
        ...requestIdFields(rid)
      },
      { status: 503, ...(rid ? { headers: { "x-request-id": rid } } : {}) }
    );
  }
}

/**
 * 二进制透传（artifact 下载、笔记文件等）。失败时尽量返回上游文本。
 */
export async function proxyBinaryFromOrchestrator(
  path: string,
  opts: FetchOrchestratorOptions = {}
): Promise<Response> {
  try {
    const upstream = await fetchOrchestrator(path, {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 120_000
    });
    const outboundRid =
      (upstream.headers.get("x-request-id") || opts.requestId || "").trim() || "";
    const ridHeaders: Record<string, string> = {};
    if (outboundRid) ridHeaders["x-request-id"] = outboundRid;
    if (!upstream.ok) {
      const t = await upstream.text();
      const ct = upstream.headers.get("content-type") || "application/json";
      return new Response(t, { status: upstream.status, headers: { "content-type": ct, ...ridHeaders } });
    }
    const buf = await upstream.arrayBuffer();
    const cd = upstream.headers.get("content-disposition");
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    const headers = new Headers();
    headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    if (outboundRid) headers.set("x-request-id", outboundRid);
    const outStatus =
      opts.forceBinarySuccessStatus !== undefined ? opts.forceBinarySuccessStatus : upstream.status;
    return new Response(buf, { status: outStatus, headers });
  } catch (err) {
    const rid = (opts.requestId || "").trim();
    return Response.json(
      {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(err),
        ...requestIdFields(rid)
      },
      { status: 503, ...(rid ? { headers: { "x-request-id": rid } } : {}) }
    );
  }
}

/** SSE：不设读超时，失败返回 JSON 503 */
export async function proxyEventStreamFromOrchestrator(
  path: string,
  opts: Omit<FetchOrchestratorOptions, "sse"> = {}
): Promise<Response> {
  try {
    const upstream = await fetchOrchestrator(path, {
      ...opts,
      method: "GET",
      sse: true,
      retryGetOnce: false
    });
    const outboundRid =
      (upstream.headers.get("x-request-id") || opts.requestId || "").trim() || "";
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...(outboundRid ? { "x-request-id": outboundRid } : {})
      }
    });
  } catch (err) {
    const rid = (opts.requestId || "").trim();
    return Response.json(
      {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(err),
        ...requestIdFields(rid)
      },
      { status: 503, ...(rid ? { headers: { "x-request-id": rid } } : {}) }
    );
  }
}

/**
 * POST body + SSE 响应（如笔记问答流式）。内部签名与 `fetchOrchestrator` POST 一致。
 */
export async function proxySsePostFromOrchestrator(
  path: string,
  opts: Omit<FetchOrchestratorOptions, "sse" | "method"> & { body: string }
): Promise<Response> {
  try {
    const raw = opts.body ?? "{}";
    const upstream = await fetchOrchestrator(path, {
      ...opts,
      method: "POST",
      sse: true,
      body: raw,
      payload: raw,
      timeoutMs: opts.timeoutMs ?? 0
    });
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const isEventStream = ct.includes("text/event-stream");
    const outboundRid =
      (upstream.headers.get("x-request-id") || opts.requestId || "").trim() || "";
    const ridHeaders: Record<string, string> = {};
    if (outboundRid) ridHeaders["x-request-id"] = outboundRid;
    /** 校验/鉴权失败等常为 JSON；勿伪装成 SSE，否则前端无法按 JSON 解析 detail */
    if (!upstream.ok || !isEventStream) {
      const text = await upstream.text();
      const outCt = ct.includes("application/json") ? "application/json" : "text/plain; charset=utf-8";
      return new Response(text, {
        status: upstream.status,
        headers: { "content-type": outCt, ...ridHeaders }
      });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        ...ridHeaders
      }
    });
  } catch (err) {
    const rid = (opts.requestId || "").trim();
    return Response.json(
      {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(err),
        ...requestIdFields(rid)
      },
      { status: 503, ...(rid ? { headers: { "x-request-id": rid } } : {}) }
    );
  }
}

/** 编排器 GET 的单段 JSON结果（与浏览器侧 `res.json().catch(() => ({}))` 语义对齐）。 */
export type OrchestratorJsonPart = {
  ok: boolean;
  status: number;
  /** 解析后的 JSON；非 JSON 或解析失败为 `{}` */
  data: unknown;
};

/**
 * 并行聚合 BFF 用：对编排器发起 GET，返回状态与解析后的 body。
 * 连接失败时 `ok` 为 false、`status` 503、`data` 为统一错误 JSON。
 */
export async function orchestratorGetJsonPart(
  path: string,
  headers: Record<string, string>,
  requestId: string
): Promise<OrchestratorJsonPart> {
  try {
    const upstream = await fetchOrchestrator(path, {
      method: "GET",
      payload: "{}",
      headers,
      requestId
    });
    const text = await upstream.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = {};
      }
    }
    return { ok: upstream.ok, status: upstream.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      data: {
        success: false,
        error: "upstream_unreachable",
        detail: describeOrchestratorUnreachable(err),
        ...requestIdFields(requestId)
      }
    };
  }
}
