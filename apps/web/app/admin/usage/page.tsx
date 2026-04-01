"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";

type TabKey = "overview" | "users" | "works" | "alerts";
type JobTypeRow = { job_type?: string; events?: number; succeeded?: number; users?: number; cost_total_cny?: number };
type InputTypeRow = { input_type?: string; events?: number };
type DayRow = { day?: string; events?: number; succeeded?: number; users?: number; cost_total_cny?: number };
type TopUserRow = { phone?: string; events?: number; succeeded?: number; cost_total_cny?: number; last_event_at?: string };
type Overview = {
  total_events?: number; succeeded_events?: number; failed_events?: number; success_rate?: number; active_users?: number;
  distinct_jobs?: number; llm_cost_cny?: number; tts_cost_cny?: number; image_cost_cny?: number; cost_total_cny?: number;
  login_count?: number; login_users?: number; active_sessions?: number; session_users?: number;
};
type UserRow = { phone?: string; events?: number; works?: number; feature_kinds?: number; cost_total_cny?: number };
type WorksOverview = { total_jobs?: number; succeeded_jobs?: number; failed_jobs?: number; avg_duration_sec?: number; p95_duration_sec?: number };
type WorksByType = { job_type?: string; jobs?: number; succeeded?: number; failed?: number; avg_duration_sec?: number };
type AlertItem = { severity?: string; day?: string; message?: string };
type AlertDay = { day?: string; events?: number; failed?: number; fail_rate?: number; cost_total_cny?: number };

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function shiftDays(base: Date, offset: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + offset);
  return next;
}
function money(n?: number): string { return `¥${Number(n || 0).toFixed(2)}`; }
function pct(n?: number): string { return `${(Number(n || 0) * 100).toFixed(1)}%`; }
function num(n?: number): string { return Number(n || 0).toLocaleString("zh-CN"); }

function MetricCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><p className="text-xs text-muted">{title}</p><p className="mt-1 text-lg font-semibold text-ink">{value}</p>{hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}</div>;
}

export default function AdminUsagePage(): JSX.Element {
  const { getAuthHeaders } = useAuth();
  const search = useSearchParams();
  const initialTab = useMemo(() => {
    const t = String(search.get("tab") || "").toLowerCase();
    return (t === "users" || t === "works" || t === "alerts") ? (t as TabKey) : "overview";
  }, [search]);
  const today = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [dateFrom, setDateFrom] = useState<string>(ymd(today));
  const [dateTo, setDateTo] = useState<string>(ymd(today));
  const [err, setErr] = useState("");
  const [usageSource, setUsageSource] = useState<string>("usage_events");

  const [overview, setOverview] = useState<Overview>({});
  const [jobRows, setJobRows] = useState<JobTypeRow[]>([]);
  const [inputRows, setInputRows] = useState<InputTypeRow[]>([]);
  const [dayRows, setDayRows] = useState<DayRow[]>([]);
  const [topUsers, setTopUsers] = useState<TopUserRow[]>([]);

  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [worksOverview, setWorksOverview] = useState<WorksOverview>({});
  const [worksByType, setWorksByType] = useState<WorksByType[]>([]);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const [alertDays, setAlertDays] = useState<AlertDay[]>([]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    return q.toString();
  }, [dateFrom, dateTo]);

  const load = useCallback(async () => {
    setErr("");
    try {
      if (tab === "overview") {
        const res = await fetch(`/api/admin/usage/dashboard?${query}`, { headers: getAuthHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; overview?: Overview; by_job_type?: JobTypeRow[]; by_input_type?: InputTypeRow[]; by_day?: DayRow[]; top_users?: TopUserRow[]; source?: string; error?: string };
        if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
        setOverview(data.overview || {});
        setJobRows(Array.isArray(data.by_job_type) ? data.by_job_type : []);
        setInputRows(Array.isArray(data.by_input_type) ? data.by_input_type : []);
        setDayRows(Array.isArray(data.by_day) ? data.by_day : []);
        setTopUsers(Array.isArray(data.top_users) ? data.top_users : []);
        setUsageSource(typeof data.source === "string" && data.source ? data.source : "usage_events");
        return;
      }
      if (tab === "users") {
        const res = await fetch(`/api/admin/usage/users?${query}&limit=100`, { headers: getAuthHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; rows?: UserRow[]; error?: string };
        if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
        setUserRows(Array.isArray(data.rows) ? data.rows : []);
        return;
      }
      if (tab === "works") {
        const res = await fetch(`/api/admin/usage/works?${query}`, { headers: getAuthHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { success?: boolean; overview?: WorksOverview; by_type?: WorksByType[]; error?: string };
        if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
        setWorksOverview(data.overview || {});
        setWorksByType(Array.isArray(data.by_type) ? data.by_type : []);
        return;
      }
      const res = await fetch(`/api/admin/usage/alerts?${query}`, { headers: getAuthHeaders(), cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; alerts?: AlertItem[]; days?: AlertDay[]; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
      setAlertItems(Array.isArray(data.alerts) ? data.alerts : []);
      setAlertDays(Array.isArray(data.days) ? data.days : []);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders, query, tab]);

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { void load(); }, [load]);

  return (
    <main className="min-h-0 max-w-7xl">
      <h1 className="text-2xl font-semibold text-ink">数据看板</h1>
      <p className="mt-2 text-sm text-muted">顶部横向导航切换模块；时间区间支持自定义，默认显示当天数据。</p>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-line pb-2">
        {[
          { key: "overview", label: "总览看板" },
          { key: "users", label: "用户分析" },
          { key: "works", label: "作品分析" },
          { key: "alerts", label: "异常告警" },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key as TabKey)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === item.key ? "bg-brand/20 text-brand" : "bg-canvas text-muted hover:bg-fill hover:text-ink"}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">从 <input type="date" className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="text-sm text-muted">到 <input type="date" className="ml-2 rounded-lg border border-line bg-canvas px-2 py-1 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <button type="button" className="rounded-lg border border-line px-3 py-1 text-sm text-ink hover:bg-fill" onClick={() => { const t = new Date(); setDateFrom(ymd(t)); setDateTo(ymd(t)); }}>今天</button>
        <button type="button" className="rounded-lg border border-line px-3 py-1 text-sm text-ink hover:bg-fill" onClick={() => { const t = new Date(); setDateFrom(ymd(shiftDays(t, -6))); setDateTo(ymd(t)); }}>近7天</button>
        <button type="button" className="rounded-lg border border-line px-3 py-1 text-sm text-ink hover:bg-fill" onClick={() => { const t = new Date(); setDateFrom(ymd(shiftDays(t, -29))); setDateTo(ymd(t)); }}>近30天</button>
        <button type="button" className="rounded-lg border border-line px-3 py-1 text-sm text-ink hover:bg-fill" onClick={() => void load()}>刷新</button>
      </div>

      {err ? <p className="mt-4 text-sm text-rose-400">{err}</p> : null}
      {tab === "overview" && usageSource === "jobs_fallback" ? <p className="mt-2 text-sm text-amber-200/90">当前为 jobs 回退数据，建议继续使用 usage_events。</p> : null}

      {tab === "overview" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard title="总调用事件" value={num(overview.total_events)} />
            <MetricCard title="成功率" value={pct(overview.success_rate)} hint={`成功 ${num(overview.succeeded_events)} / 失败 ${num(overview.failed_events)}`} />
            <MetricCard title="活跃用户" value={num(overview.active_users)} hint={`登录用户 ${num(overview.login_users)} / 登录次数 ${num(overview.login_count)}`} />
            <MetricCard title="已生成作品(任务)" value={num(overview.distinct_jobs)} />
            <MetricCard title="总成本" value={money(overview.cost_total_cny)} />
            <MetricCard title="LLM 成本" value={money(overview.llm_cost_cny)} />
            <MetricCard title="TTS 成本" value={money(overview.tts_cost_cny)} />
            <MetricCard title="图像成本" value={money(overview.image_cost_cny)} hint={`在线会话 ${num(overview.active_sessions)} / 在线用户 ${num(overview.session_users)}`} />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60"><div className="border-b border-line px-3 py-2 text-sm text-muted">功能使用</div><table className="min-w-[560px] w-full text-left text-sm text-ink"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">功能</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">成功</th><th className="px-3 py-2">用户数</th><th className="px-3 py-2">成本</th></tr></thead><tbody>{jobRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : jobRows.map((r, i) => <tr key={`${r.job_type || "unknown"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs">{r.job_type || "unknown"}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.succeeded)}</td><td className="px-3 py-2">{num(r.users)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td></tr>)}</tbody></table></div>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60"><div className="border-b border-line px-3 py-2 text-sm text-muted">输入来源分布</div><table className="min-w-[420px] w-full text-left text-sm text-ink"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">输入类型</th><th className="px-3 py-2">次数</th></tr></thead><tbody>{inputRows.length === 0 ? <tr><td colSpan={2} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : inputRows.map((r, i) => <tr key={`${r.input_type || "other"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2">{r.input_type || "other"}</td><td className="px-3 py-2">{num(r.events)}</td></tr>)}</tbody></table></div>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60"><div className="border-b border-line px-3 py-2 text-sm text-muted">按日趋势 + Top 用户</div><table className="min-w-[720px] w-full text-left text-sm text-ink"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">日期</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">成功</th><th className="px-3 py-2">用户</th><th className="px-3 py-2">成本</th></tr></thead><tbody>{dayRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : dayRows.map((r, i) => <tr key={`${r.day || "day"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2">{r.day || "—"}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.succeeded)}</td><td className="px-3 py-2">{num(r.users)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td></tr>)}</tbody></table></div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60"><div className="border-b border-line px-3 py-2 text-sm text-muted">高活跃用户（Top 20）</div><table className="min-w-[720px] w-full text-left text-sm text-ink"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">用户</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">成功</th><th className="px-3 py-2">成本</th><th className="px-3 py-2">最近使用</th></tr></thead><tbody>{topUsers.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : topUsers.map((r, i) => <tr key={`${r.phone || "unknown"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs">{r.phone || "(unknown)"}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.succeeded)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td><td className="px-3 py-2 text-xs text-muted">{r.last_event_at || "—"}</td></tr>)}</tbody></table></div>
        </>
      ) : null}

      {tab === "users" ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
          <div className="border-b border-line px-3 py-2 text-sm text-muted">用户分析（Top 100）</div>
          <table className="min-w-[720px] w-full text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">用户</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">作品</th><th className="px-3 py-2">功能数</th><th className="px-3 py-2">成本</th></tr></thead>
            <tbody>{userRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : userRows.map((r, i) => <tr key={`${r.phone || "unknown"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs">{r.phone || "(unknown)"}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.works)}</td><td className="px-3 py-2">{num(r.feature_kinds)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {tab === "works" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <MetricCard title="总任务" value={num(worksOverview.total_jobs)} />
            <MetricCard title="成功任务" value={num(worksOverview.succeeded_jobs)} />
            <MetricCard title="失败任务" value={num(worksOverview.failed_jobs)} />
            <MetricCard title="平均耗时" value={`${Number(worksOverview.avg_duration_sec || 0).toFixed(1)}s`} />
            <MetricCard title="P95 耗时" value={`${Number(worksOverview.p95_duration_sec || 0).toFixed(1)}s`} />
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">作品类型分布</div>
            <table className="min-w-[720px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">类型</th><th className="px-3 py-2">任务</th><th className="px-3 py-2">成功</th><th className="px-3 py-2">失败</th><th className="px-3 py-2">平均耗时</th></tr></thead>
              <tbody>{worksByType.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : worksByType.map((r, i) => <tr key={`${r.job_type || "other"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs">{r.job_type || "other"}</td><td className="px-3 py-2">{num(r.jobs)}</td><td className="px-3 py-2">{num(r.succeeded)}</td><td className="px-3 py-2">{num(r.failed)}</td><td className="px-3 py-2">{Number(r.avg_duration_sec || 0).toFixed(1)}s</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "alerts" ? (
        <>
          <div className="mt-6 rounded-xl border border-line bg-surface/60 p-3">
            {alertItems.length === 0 ? <p className="text-sm text-emerald-400">当前无异常告警。</p> : <ul className="space-y-2">{alertItems.map((a, i) => <li key={`${a.day || "day"}_${i}`} className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm"><span className={a.severity === "high" ? "text-rose-400" : "text-amber-300"}>[{a.severity || "info"}]</span> {a.day || "unknown"} - {a.message || "异常波动"}</li>)}</ul>}
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">按日监控指标</div>
            <table className="min-w-[720px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">日期</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">失败</th><th className="px-3 py-2">失败率</th><th className="px-3 py-2">成本</th></tr></thead>
              <tbody>{alertDays.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : alertDays.map((r, i) => <tr key={`${r.day || "day"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2">{r.day || "—"}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.failed)}</td><td className="px-3 py-2">{pct(r.fail_rate)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
