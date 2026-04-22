"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";

type TabKey = "overview" | "ledger" | "orders" | "users" | "works" | "alerts";
type JobTypeRow = { job_type?: string; events?: number; succeeded?: number; users?: number; cost_total_cny?: number };
type InputTypeRow = { input_type?: string; events?: number };
type DayRow = { day?: string; events?: number; succeeded?: number; users?: number; cost_total_cny?: number };
type TopUserRow = {
  user_key?: string;
  user_id?: string;
  phone?: string;
  events?: number;
  succeeded?: number;
  cost_total_cny?: number;
  last_event_at?: string;
};
type Overview = {
  total_events?: number; succeeded_events?: number; failed_events?: number; success_rate?: number; active_users?: number;
  distinct_jobs?: number; llm_cost_cny?: number; tts_cost_cny?: number; image_cost_cny?: number; cost_total_cny?: number;
  login_count?: number; login_users?: number; active_sessions?: number; session_users?: number;
};
type UserRow = {
  user_key?: string;
  user_id?: string;
  phone?: string;
  events?: number;
  works?: number;
  feature_kinds?: number;
  cost_total_cny?: number;
};
type WorksOverview = { total_jobs?: number; succeeded_jobs?: number; failed_jobs?: number; avg_duration_sec?: number; p95_duration_sec?: number };
type WorksByType = { job_type?: string; jobs?: number; succeeded?: number; failed?: number; avg_duration_sec?: number };
type AlertItem = { severity?: string; day?: string; message?: string };
type AlertDay = { day?: string; events?: number; failed?: number; fail_rate?: number; cost_total_cny?: number };
type OrdersOverview = {
  total_orders?: number;
  settled_orders?: number;
  failed_orders?: number;
  open_orders?: number;
  gross_settled_cents?: number;
  refunded_cents?: number;
  net_revenue_cents?: number;
  payer_phones?: number;
  aov_net_cents?: number;
};
type OrderStatusRow = { status?: string; orders?: number; settled_amount_cents?: number };
type OrderProviderRow = { provider?: string; orders?: number; settled_amount_cents?: number };
type OrderProductRow = { tier?: string; billing_cycle?: string; orders?: number; settled_amount_cents?: number };
type OrderDayRow = { day?: string; orders?: number; settled_orders?: number; gross_settled_cents?: number };
type RecentOrderRow = {
  event_id?: string;
  phone?: string;
  tier?: string;
  billing_cycle?: string | null;
  status?: string;
  amount_cents?: number;
  effective_amount_cents?: number;
  refunded_amount_cents?: number;
  provider?: string;
  channel?: string;
  created_at?: string;
};

type LedgerOverview = { expense_cny_total?: number; revenue_cents_total?: number; revenue_cny_total?: number };
type LedgerDayRow = { day?: string; expense_cny?: number; revenue_cents?: number; revenue_cny?: number };
type LedgerUserExpense = { user_key?: string; user_id?: string; phone?: string | null; events?: number; expense_cny?: number };
type LedgerUserRevenue = { phone?: string; user_id?: string | null; revenue_cents?: number; revenue_cny?: number; ledger_rows?: number };
type LedgerModelExpense = { bucket?: string; model_label?: string; expense_cny?: number };
type LedgerJobTypeRevenue = { job_type?: string; revenue_cents?: number; revenue_cny?: number; ledger_rows?: number };
type LedgerExpenseDetail = {
  usage_event_id?: number;
  created_at?: string | null;
  day?: string;
  job_id?: string;
  job_type?: string;
  terminal_status?: string;
  user_id?: string | null;
  phone?: string | null;
  expense_cny?: number;
  llm_cny?: number;
  tts_cny?: number;
  image_cny?: number;
  text_model?: string | null;
  tts_model?: string | null;
  image_model?: string | null;
};
type LedgerRevenueDetail = {
  ledger_id?: number;
  created_at?: string | null;
  day?: string;
  job_id?: string;
  job_type?: string;
  phone?: string | null;
  user_id?: string | null;
  ledger_message?: string;
  billing_model_key?: string;
  revenue_cents?: number;
  revenue_cny?: number;
};
type LedgerNotes = { expense?: string; revenue?: string; revenue_tts?: string };
type LedgerTtsModelRevenue = { model_key?: string; revenue_cents?: number; revenue_cny?: number; ledger_rows?: number };

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
function moneyCents(cents?: number): string { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function pct(n?: number): string { return `${(Number(n || 0) * 100).toFixed(1)}%`; }
function num(n?: number): string { return Number(n || 0).toLocaleString("zh-CN"); }

function MetricCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return <div className="rounded-xl border border-line bg-surface/60 px-4 py-3"><p className="text-xs text-muted">{title}</p><p className="mt-1 text-lg font-semibold text-ink">{value}</p>{hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}</div>;
}

export default function AdminUsagePage(): JSX.Element {
  const { getAuthHeaders } = useAuth();
  const search = useSearchParams();
  const initialTab = useMemo(() => {
    const t = String(search?.get("tab") ?? "").toLowerCase();
    return t === "overview" || t === "ledger" || t === "orders" || t === "users" || t === "works" || t === "alerts"
      ? (t as TabKey)
      : "overview";
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

  const [ordersOverview, setOrdersOverview] = useState<OrdersOverview>({});
  const [ordersByStatus, setOrdersByStatus] = useState<OrderStatusRow[]>([]);
  const [ordersByProvider, setOrdersByProvider] = useState<OrderProviderRow[]>([]);
  const [ordersByProduct, setOrdersByProduct] = useState<OrderProductRow[]>([]);
  const [ordersByDay, setOrdersByDay] = useState<OrderDayRow[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrderRow[]>([]);

  const [ledgerOverview, setLedgerOverview] = useState<LedgerOverview>({});
  const [ledgerNotes, setLedgerNotes] = useState<LedgerNotes>({});
  const [ledgerByDay, setLedgerByDay] = useState<LedgerDayRow[]>([]);
  const [ledgerUserExpense, setLedgerUserExpense] = useState<LedgerUserExpense[]>([]);
  const [ledgerUserRevenue, setLedgerUserRevenue] = useState<LedgerUserRevenue[]>([]);
  const [ledgerModelExpense, setLedgerModelExpense] = useState<LedgerModelExpense[]>([]);
  const [ledgerJobTypeRevenue, setLedgerJobTypeRevenue] = useState<LedgerJobTypeRevenue[]>([]);
  const [ledgerTtsModelRevenue, setLedgerTtsModelRevenue] = useState<LedgerTtsModelRevenue[]>([]);
  const [ledgerExpenseDetails, setLedgerExpenseDetails] = useState<LedgerExpenseDetail[]>([]);
  const [ledgerRevenueDetails, setLedgerRevenueDetails] = useState<LedgerRevenueDetail[]>([]);

  const query = useMemo(() => {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    return q.toString();
  }, [dateFrom, dateTo]);

  const ledgerQuery = useMemo(() => {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, detail_limit: "400" });
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
      if (tab === "ledger") {
        const res = await fetch(`/api/admin/usage/revenue-expense?${ledgerQuery}`, { headers: getAuthHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          overview?: LedgerOverview;
          notes?: LedgerNotes;
          by_day?: LedgerDayRow[];
          by_user_expense?: LedgerUserExpense[];
          by_user_revenue?: LedgerUserRevenue[];
          by_model_expense?: LedgerModelExpense[];
          by_job_type_revenue?: LedgerJobTypeRevenue[];
          by_tts_model_revenue?: LedgerTtsModelRevenue[];
          expense_details?: LedgerExpenseDetail[];
          revenue_details?: LedgerRevenueDetail[];
          error?: string;
        };
        if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
        setLedgerOverview(data.overview || {});
        setLedgerNotes(data.notes || {});
        setLedgerByDay(Array.isArray(data.by_day) ? data.by_day : []);
        setLedgerUserExpense(Array.isArray(data.by_user_expense) ? data.by_user_expense : []);
        setLedgerUserRevenue(Array.isArray(data.by_user_revenue) ? data.by_user_revenue : []);
        setLedgerModelExpense(Array.isArray(data.by_model_expense) ? data.by_model_expense : []);
        setLedgerJobTypeRevenue(Array.isArray(data.by_job_type_revenue) ? data.by_job_type_revenue : []);
        setLedgerTtsModelRevenue(Array.isArray(data.by_tts_model_revenue) ? data.by_tts_model_revenue : []);
        setLedgerExpenseDetails(Array.isArray(data.expense_details) ? data.expense_details : []);
        setLedgerRevenueDetails(Array.isArray(data.revenue_details) ? data.revenue_details : []);
        return;
      }
      if (tab === "orders") {
        const res = await fetch(`/api/admin/usage/orders?${query}`, { headers: getAuthHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          overview?: OrdersOverview;
          by_status?: OrderStatusRow[];
          by_provider?: OrderProviderRow[];
          by_product?: OrderProductRow[];
          by_day?: OrderDayRow[];
          recent_orders?: RecentOrderRow[];
          error?: string;
        };
        if (!res.ok || !data.success) throw new Error(data.error || `加载失败 ${res.status}`);
        setOrdersOverview(data.overview || {});
        setOrdersByStatus(Array.isArray(data.by_status) ? data.by_status : []);
        setOrdersByProvider(Array.isArray(data.by_provider) ? data.by_provider : []);
        setOrdersByProduct(Array.isArray(data.by_product) ? data.by_product : []);
        setOrdersByDay(Array.isArray(data.by_day) ? data.by_day : []);
        setRecentOrders(Array.isArray(data.recent_orders) ? data.recent_orders : []);
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
  }, [getAuthHeaders, ledgerQuery, query, tab]);

  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { void load(); }, [load]);

  return (
    <main className="min-h-0 max-w-7xl">
      <h1 className="text-2xl font-semibold text-ink">数据看板</h1>
      <p className="mt-2 text-sm text-muted">
        顶部横向导航切换模块；时间区间与上方日期选择一致（收支看板按 Asia/Shanghai 日历日）。订单分析按订单创建时间落入该区间的记录统计。
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-line pb-2">
        {[
          { key: "overview", label: "总览看板" },
          { key: "ledger", label: "收支看板" },
          { key: "orders", label: "订单分析" },
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

      {err ? <p className="mt-4 text-sm text-danger-ink">{err}</p> : null}
      {tab === "overview" && usageSource === "jobs_fallback" ? <p className="mt-2 text-sm text-warning-ink/90">当前为 jobs 回退数据，建议继续使用 usage_events。</p> : null}
      {tab === "ledger" && (ledgerNotes.expense || ledgerNotes.revenue || ledgerNotes.revenue_tts) ? (
        <div className="mt-3 space-y-1 rounded-lg border border-line/80 bg-surface/40 px-3 py-2 text-xs text-muted">
          {ledgerNotes.expense ? <p>{ledgerNotes.expense}</p> : null}
          {ledgerNotes.revenue ? <p>{ledgerNotes.revenue}</p> : null}
          {ledgerNotes.revenue_tts ? <p>{ledgerNotes.revenue_tts}</p> : null}
        </div>
      ) : null}

      {tab === "ledger" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard title="支出合计（参考模型价）" value={money(ledgerOverview.expense_cny_total)} hint="usage_events.meta 分项估算" />
            <MetricCard title="收入合计（钱包实扣）" value={money(ledgerOverview.revenue_cny_total)} hint={`${num(ledgerOverview.revenue_cents_total)} 分`} />
            <MetricCard title="毛利（参考）" value={money(Number(ledgerOverview.revenue_cny_total || 0) - Number(ledgerOverview.expense_cny_total || 0))} hint="收入−支出，仅供参考" />
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">按日（Asia/Shanghai）</div>
            <table className="min-w-[640px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">支出（元）</th>
                  <th className="px-3 py-2">收入（元）</th>
                </tr>
              </thead>
              <tbody>
                {ledgerByDay.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  ledgerByDay.map((r, i) => (
                    <tr key={`${r.day || "d"}_${i}`} className="border-t border-line/80">
                      <td className="px-3 py-2">{r.day || "—"}</td>
                      <td className="px-3 py-2">{money(r.expense_cny)}</td>
                      <td className="px-3 py-2">{money(r.revenue_cny)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">分用户 · 支出（Top）</div>
              <table className="min-w-[520px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">用户</th>
                    <th className="px-3 py-2">事件数</th>
                    <th className="px-3 py-2">支出</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerUserExpense.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无
                      </td>
                    </tr>
                  ) : (
                    ledgerUserExpense.map((r, i) => (
                      <tr key={`${r.user_key || r.user_id || "u"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">
                          <span className="block">{r.phone || r.user_id || r.user_key || "—"}</span>
                        </td>
                        <td className="px-3 py-2">{num(r.events)}</td>
                        <td className="px-3 py-2">{money(r.expense_cny)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">分用户 · 收入（钱包实扣）</div>
              <table className="min-w-[520px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">用户</th>
                    <th className="px-3 py-2">流水条数</th>
                    <th className="px-3 py-2">收入</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerUserRevenue.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无
                      </td>
                    </tr>
                  ) : (
                    ledgerUserRevenue.map((r, i) => (
                      <tr key={`${r.phone || r.user_id || "p"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">{r.phone || r.user_id || "—"}</td>
                        <td className="px-3 py-2">{num(r.ledger_rows)}</td>
                        <td className="px-3 py-2">{money(r.revenue_cny)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">分模型 · 支出（LLM/TTS/图像 参考价）</div>
              <table className="min-w-[560px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">类别</th>
                    <th className="px-3 py-2">模型/价目键</th>
                    <th className="px-3 py-2">支出</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerModelExpense.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无
                      </td>
                    </tr>
                  ) : (
                    ledgerModelExpense.map((r, i) => (
                      <tr key={`${r.bucket || "b"}_${r.model_label || "m"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">{r.bucket || "—"}</td>
                        <td className="max-w-[240px] truncate px-3 py-2 font-mono text-xs" title={r.model_label}>
                          {r.model_label || "—"}
                        </td>
                        <td className="px-3 py-2">{money(r.expense_cny)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">分任务类型 · 收入（钱包实扣）</div>
              <table className="min-w-[480px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">job_type</th>
                    <th className="px-3 py-2">流水条数</th>
                    <th className="px-3 py-2">收入</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerJobTypeRevenue.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无
                      </td>
                    </tr>
                  ) : (
                    ledgerJobTypeRevenue.map((r, i) => (
                      <tr key={`${r.job_type || "jt"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">{r.job_type || "—"}</td>
                        <td className="px-3 py-2">{num(r.ledger_rows)}</td>
                        <td className="px-3 py-2">{money(r.revenue_cny)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">按 TTS / 计费模型键 · 收入（含非 TTS 类目）</div>
            <table className="min-w-[560px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">模型键</th>
                  <th className="px-3 py-2">流水条数</th>
                  <th className="px-3 py-2">收入</th>
                </tr>
              </thead>
              <tbody>
                {ledgerTtsModelRevenue.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted">
                      暂无
                    </td>
                  </tr>
                ) : (
                  ledgerTtsModelRevenue.map((r, i) => (
                    <tr key={`${r.model_key || "mk"}_${i}`} className="border-t border-line/80">
                      <td className="max-w-[320px] truncate px-3 py-2 font-mono text-xs" title={r.model_key}>
                        {r.model_key || "—"}
                      </td>
                      <td className="px-3 py-2">{num(r.ledger_rows)}</td>
                      <td className="px-3 py-2">{money(r.revenue_cny)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">支出明细（最多 400 条，任务终态用量事件）</div>
            <table className="min-w-[1180px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">日</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">job_id</th>
                  <th className="px-3 py-2">job_type</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">合计</th>
                  <th className="px-3 py-2">LLM</th>
                  <th className="px-3 py-2">TTS</th>
                  <th className="px-3 py-2">图</th>
                  <th className="px-3 py-2">文本模型</th>
                  <th className="px-3 py-2">TTS 模型</th>
                </tr>
              </thead>
              <tbody>
                {ledgerExpenseDetails.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-muted">
                      暂无
                    </td>
                  </tr>
                ) : (
                  ledgerExpenseDetails.map((r, i) => (
                    <tr key={`${r.usage_event_id ?? "e"}_${i}`} className="border-t border-line/80">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{r.created_at || "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.day || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.phone || r.user_id || "—"}</td>
                      <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px]" title={r.job_id}>
                        {r.job_id ? `${r.job_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[11px]" title={r.job_type}>
                        {r.job_type || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.terminal_status || "—"}</td>
                      <td className="px-3 py-2">{money(r.expense_cny)}</td>
                      <td className="px-3 py-2">{money(r.llm_cny)}</td>
                      <td className="px-3 py-2">{money(r.tts_cny)}</td>
                      <td className="px-3 py-2">{money(r.image_cny)}</td>
                      <td className="max-w-[100px] truncate px-3 py-2 text-[10px] font-mono" title={r.text_model || ""}>
                        {r.text_model || "—"}
                      </td>
                      <td className="max-w-[100px] truncate px-3 py-2 text-[10px] font-mono" title={r.tts_model || ""}>
                        {r.tts_model || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">收入明细（最多 400 条，钱包扣费流水）</div>
            <table className="min-w-[1180px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">日</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">job_id</th>
                  <th className="px-3 py-2">job_type</th>
                  <th className="px-3 py-2">计费模型键</th>
                  <th className="px-3 py-2">金额</th>
                  <th className="px-3 py-2">摘要</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRevenueDetails.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted">
                      暂无
                    </td>
                  </tr>
                ) : (
                  ledgerRevenueDetails.map((r, i) => (
                    <tr key={`${r.ledger_id ?? "l"}_${i}`} className="border-t border-line/80">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{r.created_at || "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.day || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.phone || r.user_id || "—"}</td>
                      <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px]" title={r.job_id}>
                        {r.job_id ? `${r.job_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[11px]" title={r.job_type}>
                        {r.job_type || "—"}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[10px]" title={r.billing_model_key}>
                        {r.billing_model_key || "—"}
                      </td>
                      <td className="px-3 py-2">{money(r.revenue_cny)}</td>
                      <td className="max-w-[320px] truncate px-3 py-2 text-xs text-muted" title={r.ledger_message}>
                        {r.ledger_message || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

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
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60"><div className="border-b border-line px-3 py-2 text-sm text-muted">高活跃用户（Top 20）</div><table className="min-w-[720px] w-full text-left text-sm text-ink"><thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">用户</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">成功</th><th className="px-3 py-2">成本</th><th className="px-3 py-2">最近使用</th></tr></thead><tbody>{topUsers.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : topUsers.map((r, i) => <tr key={`${r.user_key || r.user_id || r.phone || "unknown"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs"><span className="block">{r.phone || r.user_id || r.user_key || "(unknown)"}</span>{r.user_id && r.phone && r.user_id !== r.phone ? <span className="mt-0.5 block text-[10px] text-muted/90">id {r.user_id}</span> : null}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.succeeded)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td><td className="px-3 py-2 text-xs text-muted">{r.last_event_at || "—"}</td></tr>)}</tbody></table></div>
        </>
      ) : null}

      {tab === "orders" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-4">
            <MetricCard title="下单笔数" value={num(ordersOverview.total_orders)} hint="时间窗内创建的全部订单" />
            <MetricCard title="成交笔数" value={num(ordersOverview.settled_orders)} hint="已支付或部分退款" />
            <MetricCard title="在途 / 失败" value={`${num(ordersOverview.open_orders)} / ${num(ordersOverview.failed_orders)}`} hint="在途：待支付等未终态" />
            <MetricCard title="付费人数（手机号）" value={num(ordersOverview.payer_phones)} />
            <MetricCard title="成交 GMV" value={moneyCents(ordersOverview.gross_settled_cents)} hint="含已确认收款金额" />
            <MetricCard title="退款" value={moneyCents(ordersOverview.refunded_cents)} />
            <MetricCard title="净收入" value={moneyCents(ordersOverview.net_revenue_cents)} hint="GMV − 退款（不低于 0）" />
            <MetricCard title="客单价（净）" value={moneyCents(ordersOverview.aov_net_cents)} hint="净收入 / 成交笔数" />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">按状态</div>
              <table className="min-w-[480px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">订单数</th>
                    <th className="px-3 py-2">成交金额</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersByStatus.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    ordersByStatus.map((r, i) => (
                      <tr key={`${r.status || "s"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">{r.status || "—"}</td>
                        <td className="px-3 py-2">{num(r.orders)}</td>
                        <td className="px-3 py-2">{moneyCents(r.settled_amount_cents)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line bg-surface/60">
              <div className="border-b border-line px-3 py-2 text-sm text-muted">按支付渠道</div>
              <table className="min-w-[480px] w-full text-left text-sm text-ink">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">渠道</th>
                    <th className="px-3 py-2">订单数</th>
                    <th className="px-3 py-2">成交金额</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersByProvider.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-muted">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    ordersByProvider.map((r, i) => (
                      <tr key={`${r.provider || "p"}_${i}`} className="border-t border-line/80">
                        <td className="px-3 py-2 font-mono text-xs">{r.provider || "—"}</td>
                        <td className="px-3 py-2">{num(r.orders)}</td>
                        <td className="px-3 py-2">{moneyCents(r.settled_amount_cents)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">按套餐维度（tier × 周期）</div>
            <table className="min-w-[640px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">套餐</th>
                  <th className="px-3 py-2">周期</th>
                  <th className="px-3 py-2">订单数</th>
                  <th className="px-3 py-2">成交金额</th>
                </tr>
              </thead>
              <tbody>
                {ordersByProduct.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  ordersByProduct.map((r, i) => (
                    <tr key={`${r.tier || "t"}_${r.billing_cycle || "c"}_${i}`} className="border-t border-line/80">
                      <td className="px-3 py-2 font-mono text-xs">{r.tier || "—"}</td>
                      <td className="px-3 py-2">{r.billing_cycle || "—"}</td>
                      <td className="px-3 py-2">{num(r.orders)}</td>
                      <td className="px-3 py-2">{moneyCents(r.settled_amount_cents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">按日趋势（Asia/Shanghai）</div>
            <table className="min-w-[640px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">下单</th>
                  <th className="px-3 py-2">成交笔数</th>
                  <th className="px-3 py-2">成交 GMV</th>
                </tr>
              </thead>
              <tbody>
                {ordersByDay.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  ordersByDay.map((r, i) => (
                    <tr key={`${String(r.day || "")}_${i}`} className="border-t border-line/80">
                      <td className="px-3 py-2">{r.day != null ? String(r.day) : "—"}</td>
                      <td className="px-3 py-2">{num(r.orders)}</td>
                      <td className="px-3 py-2">{num(r.settled_orders)}</td>
                      <td className="px-3 py-2">{moneyCents(r.gross_settled_cents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
            <div className="border-b border-line px-3 py-2 text-sm text-muted">最近订单（最多 40 条，按创建时间倒序）</div>
            <table className="min-w-[960px] w-full text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">事件 ID</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">套餐</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">标价</th>
                  <th className="px-3 py-2">有效金额</th>
                  <th className="px-3 py-2">已退</th>
                  <th className="px-3 py-2">渠道</th>
                  <th className="px-3 py-2">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-muted">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  recentOrders.map((r, i) => (
                    <tr key={`${r.event_id || "e"}_${i}`} className="border-t border-line/80">
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-[11px]" title={r.event_id}>
                        {r.event_id || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.phone || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.tier || "—"}
                        {r.billing_cycle ? <span className="text-muted"> / {r.billing_cycle}</span> : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.status || "—"}</td>
                      <td className="px-3 py-2">{moneyCents(r.amount_cents)}</td>
                      <td className="px-3 py-2">{moneyCents(r.effective_amount_cents)}</td>
                      <td className="px-3 py-2">{moneyCents(r.refunded_amount_cents)}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono">{r.provider || "—"}</span>
                        {r.channel && r.channel !== r.provider ? <span className="text-muted"> ({r.channel})</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{r.created_at || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === "users" ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface/60">
          <div className="border-b border-line px-3 py-2 text-sm text-muted">用户分析（Top 100）</div>
          <table className="min-w-[720px] w-full text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-muted"><tr><th className="px-3 py-2">用户</th><th className="px-3 py-2">调用</th><th className="px-3 py-2">作品</th><th className="px-3 py-2">功能数</th><th className="px-3 py-2">成本</th></tr></thead>
            <tbody>{userRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">暂无数据</td></tr> : userRows.map((r, i) => <tr key={`${r.user_key || r.user_id || r.phone || "unknown"}_${i}`} className="border-t border-line/80"><td className="px-3 py-2 font-mono text-xs"><span className="block">{r.phone || r.user_id || r.user_key || "(unknown)"}</span>{r.user_id && r.phone && r.user_id !== r.phone ? <span className="mt-0.5 block text-[10px] text-muted/90">id {r.user_id}</span> : null}</td><td className="px-3 py-2">{num(r.events)}</td><td className="px-3 py-2">{num(r.works)}</td><td className="px-3 py-2">{num(r.feature_kinds)}</td><td className="px-3 py-2">{money(r.cost_total_cny)}</td></tr>)}</tbody>
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
            {alertItems.length === 0 ? <p className="text-sm text-success-ink">当前无异常告警。</p> : <ul className="space-y-2">{alertItems.map((a, i) => <li key={`${a.day || "day"}_${i}`} className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm"><span className={a.severity === "high" ? "text-danger-ink" : "text-warning-ink"}>[{a.severity || "info"}]</span> {a.day || "unknown"} - {a.message || "异常波动"}</li>)}</ul>}
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
