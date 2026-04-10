"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ADMIN_MODEL_CATALOG } from "../../../lib/adminModelCatalog";
import { apiErrorMessage } from "../../../lib/apiError";
import { useAuth } from "../../../lib/auth";

function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

type UsageRow = {
  job_type?: string;
  events?: number;
  succeeded?: number;
  failed?: number;
  cancelled?: number;
  distinct_jobs?: number;
  llm_cost_cny?: number | string;
  tts_cost_cny?: number | string;
  image_cost_cny?: number | string;
  cost_total_cny?: number | string;
};

type ModelAgg = {
  id: string;
  name: string;
  category: string;
  usage: string;
  billing: string;
  features: string[];
  details: string[];
  estimatedCostCny: number;
  totalEvents: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  breakdown: UsageRow[];
};

export default function AdminModelsPage() {
  const { getAuthHeaders } = useAuth();
  const [dateFrom, setDateFrom] = useState(() => localDateYmd());
  const [dateTo, setDateTo] = useState(() => localDateYmd());
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [usageSource, setUsageSource] = useState<string>("usage_events");
  const [expandedId, setExpandedId] = useState<string>("");
  const [err, setErr] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setErr("");
    try {
      const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`/api/admin/usage?${q.toString()}`, { headers: getAuthHeaders(), cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        rows?: UsageRow[];
        source?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(apiErrorMessage(data, `加载失败 ${res.status}`));
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setUsageSource(typeof data.source === "string" && data.source ? data.source : "usage_events");
    } catch (e) {
      setRows([]);
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [dateFrom, dateTo, getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    };
    const id = window.setInterval(tick, 45_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  const grouped = useMemo(() => {
    const byType = new Map<string, UsageRow>();
    for (const item of rows) {
      const key = String(item.job_type || "").trim();
      if (key) byType.set(key, item);
    }

    const costFromMeta = (breakdown: UsageRow[], field: (typeof ADMIN_MODEL_CATALOG)[number]["costField"]): number => {
      if (field === "none" || field === "fixed") return 0;
      return breakdown.reduce((s, x) => {
        if (field === "llm") return s + num(x.llm_cost_cny);
        if (field === "tts") return s + num(x.tts_cost_cny);
        return s + num(x.image_cost_cny);
      }, 0);
    };

    const out: ModelAgg[] = ADMIN_MODEL_CATALOG.map((m) => {
      const breakdown = m.jobTypes
        .map((jt) => byType.get(jt))
        .filter((v): v is UsageRow => Boolean(v))
        .sort((a, b) => Number(b.events || 0) - Number(a.events || 0));
      const totalEvents = breakdown.reduce((s, x) => s + Number(x.events || 0), 0);
      const succeeded = breakdown.reduce((s, x) => s + Number(x.succeeded || 0), 0);
      const failed = breakdown.reduce((s, x) => s + Number(x.failed || 0), 0);
      const cancelled = breakdown.reduce((s, x) => s + Number(x.cancelled || 0), 0);
      const metaCost = costFromMeta(breakdown, m.costField);
      const fallbackCost = totalEvents * m.estimatedUnitCostCny;
      const estimatedCostCny =
        m.costField === "fixed"
          ? totalEvents * m.estimatedUnitCostCny
          : m.costField === "none"
            ? 0
            : metaCost > 0
              ? metaCost
              : fallbackCost;
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        usage: m.usage,
        billing: m.billing,
        features: m.features,
        details: m.details,
        estimatedCostCny,
        totalEvents,
        succeeded,
        failed,
        cancelled,
        breakdown
      };
    });
    return out.sort((a, b) => b.totalEvents - a.totalEvents);
  }, [rows]);

  const categorySummary = useMemo(() => {
    const acc = new Map<string, { cost: number }>();
    for (const item of grouped) {
      const prev = acc.get(item.category) || { cost: 0 };
      acc.set(item.category, {
        cost: prev.cost + item.estimatedCostCny
      });
    }
    return Array.from(acc.entries()).map(([category, v]) => ({ category, ...v }));
  }, [grouped]);

  const terminalEventsTotal = useMemo(() => rows.reduce((s, x) => s + Number(x.events || 0), 0), [rows]);
  const distinctJobsTotal = useMemo(() => rows.reduce((s, x) => s + Number(x.distinct_jobs || 0), 0), [rows]);
  const totalEstimatedCost = grouped.reduce((s, x) => s + x.estimatedCostCny, 0);

  const formatCny = (n: number) =>
    new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(n);

  return (
    <main className="min-h-0 max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink">模型管理</h1>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">
          开始日期
          <input
            type="date"
            className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1 text-sm text-ink"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label className="text-sm text-muted">
          结束日期
          <input
            type="date"
            className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1 text-sm text-ink"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <button type="button" className="rounded-lg border border-line px-3 py-1 text-sm text-ink hover:bg-fill" onClick={() => void load()}>
          刷新
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="rounded border-line"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          每 45 秒自动刷新（前台可见时）
        </label>
        <span className="text-xs text-muted">
          去重任务：{distinctJobsTotal} · 终态事件：{terminalEventsTotal}
          {usageSource === "jobs_fallback" ? (
            <span className="ml-2 rounded border border-warning/40 bg-warning-soft/10 px-1.5 py-0.5 text-warning-ink/90">
              jobs 回退
            </span>
          ) : null}
        </span>
        <span className="text-xs">
          <span className="text-muted">估算费用：</span>
          <span className="font-semibold tabular-nums text-ink">{formatCny(totalEstimatedCost)}</span>
        </span>
      </div>

      {err ? <p className="mt-4 text-sm text-danger-ink">{err}</p> : null}

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {categorySummary.map((c) => (
          <section key={c.category} className="rounded-xl border border-line bg-surface/60 p-4 text-sm text-ink shadow-soft">
            <h2 className="text-sm font-semibold text-ink">{c.category}</h2>
            <p className="mt-2 text-xs">
              <span className="text-muted">估算费用：</span>
              <span className="font-semibold tabular-nums text-ink">{formatCny(c.cost)}</span>
            </p>
          </section>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
        <table className="min-w-[900px] w-full text-left text-sm text-ink">
          <thead className="border-b border-line text-xs text-muted">
            <tr>
              <th className="px-3 py-2">模型</th>
              <th className="px-3 py-2">分类</th>
              <th className="px-3 py-2">用量（任务数）</th>
              <th className="px-3 py-2">成功</th>
              <th className="px-3 py-2">失败</th>
              <th className="px-3 py-2">取消</th>
              <th className="px-3 py-2">估算费用</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="border-t border-line/80">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-medium text-brand hover:text-brand/80"
                        onClick={() => setExpandedId(expanded ? "" : row.id)}
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="px-3 py-2">{row.category}</td>
                    <td className="px-3 py-2">{row.totalEvents}</td>
                    <td className="px-3 py-2">{row.succeeded}</td>
                    <td className="px-3 py-2">{row.failed}</td>
                    <td className="px-3 py-2">{row.cancelled}</td>
                    <td className="px-3 py-2 font-medium tabular-nums text-ink">{formatCny(row.estimatedCostCny)}</td>
                  </tr>
                  {expanded ? (
                    <tr className="border-t border-line/60 bg-canvas/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted">用量说明</p>
                            <p className="mt-1 text-sm text-muted">{row.usage}</p>
                            <p className="mt-3 text-xs uppercase tracking-wide text-muted">费用说明</p>
                            <p className="mt-1 text-sm text-muted">{row.billing}</p>
                            <ul className="mt-3 space-y-1 text-xs text-muted">
                              {row.details.map((d) => (
                                <li key={d}>- {d}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted">对应功能 / 任务</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {row.features.map((f) => (
                                <span key={f} className="rounded-md border border-line bg-canvas/80 px-2 py-0.5 text-xs text-muted">
                                  {f}
                                </span>
                              ))}
                            </div>
                            <p className="mt-3 text-xs uppercase tracking-wide text-muted">任务明细</p>
                            <div className="mt-1 space-y-1 text-xs text-muted">
                              {row.breakdown.length === 0 ? (
                                <p>当前时间段内无对应任务数据。</p>
                              ) : (
                                row.breakdown.map((b) => (
                                  <p key={b.job_type}>
                                    {b.job_type}: {b.events ?? 0}（成功 {b.succeeded ?? 0} / 失败 {b.failed ?? 0} / 取消 {b.cancelled ?? 0}）
                                  </p>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
