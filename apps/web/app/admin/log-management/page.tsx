"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/auth";

type LogSwitchConfig = {
  scope: string;
  enabled: boolean;
  env: string;
  minLevel: "info" | "debug";
  sampleRate: number;
  expiresAtMs: number | null;
  updatedAtMs: number;
  updatedBy: string;
  reason: string;
};
type LogScope = "notebook_share_client" | "frontend_global_error";

type LogAudit = {
  id: string;
  action: "enable" | "disable";
  operator: string;
  env: string;
  sampleRate: number;
  ttlMinutes: number | null;
  reason: string;
  atMs: number;
};

type LogEvent = {
  id: string;
  scope: LogScope;
  requestId: string;
  traceId: string;
  errorCode: string;
  env: string;
  release: string;
  module: string;
  route: string;
  level: "info" | "error";
  message: string;
  location?: string;
  payload?: Record<string, unknown>;
  atMs: number;
};

type ErrorCluster = {
  key: string;
  errorCode: string;
  route: string;
  module: string;
  level: "info" | "error";
  count: number;
  latestAtMs: number;
};

function formatTime(tsMs: number | null | undefined): string {
  if (!tsMs || !Number.isFinite(tsMs)) return "—";
  try {
    return new Date(tsMs).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

export default function AdminLogManagementPage() {
  const { getAuthHeaders } = useAuth();
  const [scope, setScope] = useState<LogScope>("notebook_share_client");
  const [scopes, setScopes] = useState<LogScope[]>(["notebook_share_client", "frontend_global_error"]);
  const [config, setConfig] = useState<LogSwitchConfig | null>(null);
  const [audits, setAudits] = useState<LogAudit[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [ttlMinutes, setTtlMinutes] = useState("30");
  const [sampleRate, setSampleRate] = useState("1");
  const [minLevel, setMinLevel] = useState<"info" | "debug">("info");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [clusters, setClusters] = useState<ErrorCluster[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [queryRequestId, setQueryRequestId] = useState("");
  const [queryErrorCode, setQueryErrorCode] = useState("");
  const [queryLevel, setQueryLevel] = useState<"" | "info" | "error">("");
  const [queryRangeHours, setQueryRangeHours] = useState("24");

  function pickErrorMessage(data: { error?: unknown }, fallback: string): string {
    if (typeof data.error === "string" && data.error) return data.error;
    if (data.error && typeof data.error === "object") {
      const msg = (data.error as { message?: unknown }).message;
      if (typeof msg === "string" && msg) return msg;
      const code = (data.error as { code?: unknown }).code;
      if (typeof code === "string" && code) return code;
    }
    return fallback;
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/log-management?scope=${encodeURIComponent(scope)}`, {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      scopes?: LogScope[];
      config?: LogSwitchConfig;
      audits?: LogAudit[];
    };
    if (!res.ok || !data.success || !data.config) {
      throw new Error(pickErrorMessage(data, `加载失败 ${res.status}`));
    }
    setConfig(data.config);
    if (Array.isArray(data.scopes) && data.scopes.length > 0) {
      setScopes(data.scopes);
    }
    setAudits(Array.isArray(data.audits) ? data.audits : []);
    setEnabled(Boolean(data.config.enabled));
    setTtlMinutes(data.config.expiresAtMs ? String(Math.max(1, Math.round((data.config.expiresAtMs - Date.now()) / 60_000))) : "30");
    setSampleRate(String(data.config.sampleRate ?? 1));
    setMinLevel(data.config.minLevel === "debug" ? "debug" : "info");
  }, [getAuthHeaders, scope]);

  useEffect(() => {
    void load().catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
  }, [load]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const hours = Number.parseInt(queryRangeHours, 10);
      const fromMs =
        Number.isFinite(hours) && hours > 0 ? Date.now() - Math.min(hours, 24 * 30) * 60 * 60 * 1000 : undefined;
      const params = new URLSearchParams();
      params.set("scope", scope);
      params.set("limit", "120");
      if (queryRequestId.trim()) params.set("requestId", queryRequestId.trim());
      if (queryErrorCode.trim()) params.set("errorCode", queryErrorCode.trim());
      if (queryLevel) params.set("level", queryLevel);
      if (fromMs) params.set("fromMs", String(fromMs));
      const res = await fetch(`/api/admin/log-events?${params.toString()}`, {
        headers: getAuthHeaders(),
        cache: "no-store"
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: unknown;
        events?: LogEvent[];
        clusters?: ErrorCluster[];
      };
      if (!res.ok || !data.success) {
        throw new Error(pickErrorMessage(data, `日志加载失败 ${res.status}`));
      }
      setEvents(Array.isArray(data.events) ? data.events : []);
      setClusters(Array.isArray(data.clusters) ? data.clusters : []);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setEventsLoading(false);
    }
  }, [getAuthHeaders, scope, queryRequestId, queryErrorCode, queryLevel, queryRangeHours]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const expiresText = useMemo(() => formatTime(config?.expiresAtMs), [config?.expiresAtMs]);

  async function submitUpdate(nextEnabled: boolean) {
    setBusy(true);
    setMsg("");
    try {
      const ttl = Number.parseInt(ttlMinutes.trim(), 10);
      const sample = Number.parseFloat(sampleRate.trim());
      const res = await fetch("/api/admin/log-management", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          enabled: nextEnabled,
          scope,
          ttlMinutes: Number.isFinite(ttl) ? ttl : 30,
          sampleRate: Number.isFinite(sample) ? sample : 1,
          minLevel,
          reason: reason.trim()
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: unknown;
        config?: LogSwitchConfig;
      };
      if (!res.ok || !data.success || !data.config) {
        throw new Error(pickErrorMessage(data, `更新失败 ${res.status}`));
      }
      setConfig(data.config);
      setEnabled(data.config.enabled);
      setMsg(data.config.enabled ? "日志调试已开启" : "日志调试已关闭");
      await load();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-0 min-w-0 w-full max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink">日志管理</h1>
      <p className="mt-2 text-sm text-muted">
        管理员可按时间窗开启客户端诊断日志，支持采样率与级别控制，默认作用于当前部署环境。
      </p>

      <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">日志范围</h2>
        <div className="mt-3 max-w-xs">
          <select
            className="w-full rounded bg-canvas p-2 text-sm text-ink"
            value={scope}
            onChange={(e) => setScope(e.target.value as LogScope)}
          >
            {scopes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">当前状态</h2>
        <div className="mt-3 grid gap-2 text-sm text-muted md:grid-cols-2">
          <p>范围：{scope}</p>
          <p>开关：{config?.enabled ? "开启" : "关闭"}</p>
          <p>环境：{config?.env || "—"}</p>
          <p>最小级别：{config?.minLevel || "—"}</p>
          <p>采样率：{typeof config?.sampleRate === "number" ? config.sampleRate : "—"}</p>
          <p>到期时间：{expiresText}</p>
          <p>最后操作人：{config?.updatedBy || "—"}</p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">开关配置</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            TTL（分钟）
            <input
              className="rounded bg-canvas p-2 text-sm text-ink"
              inputMode="numeric"
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(e.target.value)}
              placeholder="30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            采样率（0~1）
            <input
              className="rounded bg-canvas p-2 text-sm text-ink"
              inputMode="decimal"
              value={sampleRate}
              onChange={(e) => setSampleRate(e.target.value)}
              placeholder="1"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            最小级别
            <select
              className="rounded bg-canvas p-2 text-sm text-ink"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value === "debug" ? "debug" : "info")}
            >
              <option value="info">info</option>
              <option value="debug">debug</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            变更原因
            <input
              className="rounded bg-canvas p-2 text-sm text-ink"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="定位某次分享失败"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-brand px-3 py-2 text-sm text-brand-foreground hover:bg-brand/90 disabled:opacity-60"
            disabled={busy}
            onClick={() => void submitUpdate(true)}
          >
            {busy && enabled ? "处理中…" : "开启日志调试"}
          </button>
          <button
            type="button"
            className="rounded border border-line bg-canvas px-3 py-2 text-sm text-ink hover:bg-fill disabled:opacity-60"
            disabled={busy}
            onClick={() => void submitUpdate(false)}
          >
            {busy && !enabled ? "处理中…" : "关闭日志调试"}
          </button>
        </div>
      </section>

      <section className="mt-6 min-w-0 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">最近操作审计</h2>
        <div className="mt-3 min-w-0 overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-2 py-2">时间</th>
                <th className="px-2 py-2">动作</th>
                <th className="px-2 py-2">操作人</th>
                <th className="px-2 py-2">环境</th>
                <th className="px-2 py-2">采样率</th>
                <th className="px-2 py-2">TTL</th>
                <th className="px-2 py-2">原因</th>
              </tr>
            </thead>
            <tbody>
              {audits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-muted">
                    暂无审计记录
                  </td>
                </tr>
              ) : null}
              {audits.map((item) => (
                <tr key={item.id} className="border-t border-line text-ink">
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{formatTime(item.atMs)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">{item.action === "enable" ? "开启" : "关闭"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">{item.operator || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{item.env || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums">{item.sampleRate}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{item.ttlMinutes ? `${item.ttlMinutes} 分钟` : "—"}</td>
                  <td className="px-2 py-2 text-xs text-muted">{item.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 min-w-0 rounded-xl border border-line bg-surface/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink">最近日志事件</h2>
          <button
            type="button"
            className="rounded border border-line bg-canvas px-2.5 py-1 text-xs text-ink hover:bg-fill disabled:opacity-60"
            disabled={eventsLoading}
            onClick={() => void loadEvents()}
          >
            {eventsLoading ? "刷新中…" : "刷新"}
          </button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input
            className="rounded bg-canvas p-2 text-xs text-ink"
            placeholder="按 requestId 筛选"
            value={queryRequestId}
            onChange={(e) => setQueryRequestId(e.target.value)}
          />
          <input
            className="rounded bg-canvas p-2 text-xs text-ink"
            placeholder="按 error.code 筛选"
            value={queryErrorCode}
            onChange={(e) => setQueryErrorCode(e.target.value)}
          />
          <select
            className="rounded bg-canvas p-2 text-xs text-ink"
            value={queryLevel}
            onChange={(e) => setQueryLevel((e.target.value || "") as "" | "info" | "error")}
          >
            <option value="">全部级别</option>
            <option value="error">error</option>
            <option value="info">info</option>
          </select>
          <input
            className="rounded bg-canvas p-2 text-xs text-ink"
            inputMode="numeric"
            placeholder="时间范围(小时)"
            value={queryRangeHours}
            onChange={(e) => setQueryRangeHours(e.target.value)}
          />
        </div>
        <div className="mt-3 min-w-0 overflow-x-auto">
          <h3 className="mb-2 text-xs font-medium text-muted">24 小时错误聚类 Top</h3>
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-2 py-2">error.code</th>
                <th className="px-2 py-2">模块</th>
                <th className="px-2 py-2">路由</th>
                <th className="px-2 py-2">级别</th>
                <th className="px-2 py-2">次数</th>
                <th className="px-2 py-2">最近出现</th>
              </tr>
            </thead>
            <tbody>
              {clusters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-xs text-muted">
                    暂无聚类数据
                  </td>
                </tr>
              ) : null}
              {clusters.map((c) => (
                <tr key={c.key} className="border-t border-line text-ink">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{c.errorCode}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{c.module}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{c.route}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">{c.level}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums">{c.count}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{formatTime(c.latestAtMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 min-w-0 overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-2 py-2">时间</th>
                <th className="px-2 py-2">级别</th>
                <th className="px-2 py-2">error.code</th>
                <th className="px-2 py-2">requestId</th>
                <th className="px-2 py-2">traceId</th>
                <th className="px-2 py-2">模块/路由</th>
                <th className="px-2 py-2">位置</th>
                <th className="px-2 py-2">信息</th>
                <th className="px-2 py-2">摘要</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-2 py-8 text-center text-muted">
                    暂无日志事件（请确认 scope 已开启且已复现问题）
                  </td>
                </tr>
              ) : null}
              {events.map((item) => (
                <tr key={item.id} className="border-t border-line text-ink">
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{formatTime(item.atMs)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    <span className={item.level === "error" ? "text-danger-ink" : "text-muted"}>{item.level}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px]">{item.errorCode || "UNKNOWN_ERROR"}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-muted">{item.requestId || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-muted">{item.traceId || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">
                    {item.module || "web"} / {item.route || "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{item.location || "—"}</td>
                  <td className="max-w-[24rem] truncate px-2 py-2 text-xs" title={item.message}>
                    {item.message || "—"}
                  </td>
                  <td className="max-w-[20rem] truncate px-2 py-2 text-xs text-muted" title={JSON.stringify(item.payload || {})}>
                    {JSON.stringify(item.payload || {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {msg ? <p className="mt-3 text-sm text-muted">{msg}</p> : null}
    </main>
  );
}
