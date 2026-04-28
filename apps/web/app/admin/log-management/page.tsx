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
  const [config, setConfig] = useState<LogSwitchConfig | null>(null);
  const [audits, setAudits] = useState<LogAudit[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [ttlMinutes, setTtlMinutes] = useState("30");
  const [sampleRate, setSampleRate] = useState("1");
  const [minLevel, setMinLevel] = useState<"info" | "debug">("info");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/log-management", {
      headers: getAuthHeaders(),
      cache: "no-store"
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      config?: LogSwitchConfig;
      audits?: LogAudit[];
    };
    if (!res.ok || !data.success || !data.config) {
      throw new Error(data.error || `加载失败 ${res.status}`);
    }
    setConfig(data.config);
    setAudits(Array.isArray(data.audits) ? data.audits : []);
    setEnabled(Boolean(data.config.enabled));
    setTtlMinutes(data.config.expiresAtMs ? String(Math.max(1, Math.round((data.config.expiresAtMs - Date.now()) / 60_000))) : "30");
    setSampleRate(String(data.config.sampleRate ?? 1));
    setMinLevel(data.config.minLevel === "debug" ? "debug" : "info");
  }, [getAuthHeaders]);

  useEffect(() => {
    void load().catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
  }, [load]);

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
          ttlMinutes: Number.isFinite(ttl) ? ttl : 30,
          sampleRate: Number.isFinite(sample) ? sample : 1,
          minLevel,
          reason: reason.trim()
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        config?: LogSwitchConfig;
      };
      if (!res.ok || !data.success || !data.config) {
        throw new Error(data.error || `更新失败 ${res.status}`);
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
        <h2 className="text-sm font-medium text-ink">当前状态</h2>
        <div className="mt-3 grid gap-2 text-sm text-muted md:grid-cols-2">
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

      {msg ? <p className="mt-3 text-sm text-muted">{msg}</p> : null}
    </main>
  );
}
