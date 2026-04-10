"use client";

import { useCallback, useEffect, useState } from "react";
import SmallConfirmModal from "../../../components/ui/SmallConfirmModal";
import { useAuth } from "../../../lib/auth";

type AdminUser = {
  user_id?: string;
  phone: string;
  email?: string;
  username?: string;
  role?: string;
  plan?: string;
  billing_cycle?: string | null;
  has_password?: boolean;
  created_at?: number;
  email_verified?: boolean;
};

function rowKey(u: AdminUser): string {
  return (u.user_id || u.phone || u.email || u.username || "").trim();
}

function formatRegisteredAt(ts: number | undefined) {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

function roleLabel(role: string | undefined) {
  const r = (role || "user").toLowerCase();
  if (r === "admin") return "管理员";
  return "普通用户";
}

export default function AdminUsersPage() {
  const { getAuthHeaders } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [plan, setPlan] = useState("free");
  const [billing, setBilling] = useState("monthly");
  const [rowPlans, setRowPlans] = useState<Record<string, string>>({});
  const [rowBilling, setRowBilling] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", { headers: getAuthHeaders(), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; users?: AdminUser[]; error?: string; detail?: string };
    if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
    const list = data.users || [];
    setUsers(list);
    setRowPlans((prev) => {
      const next = { ...prev };
      for (const u of list) {
        const k = rowKey(u);
        if (k && next[k] === undefined) next[k] = u.plan || "free";
      }
      return next;
    });
    setRowBilling((prev) => {
      const next = { ...prev };
      for (const u of list) {
        const k = rowKey(u);
        if (k && next[k] === undefined) next[k] = (u.billing_cycle as string) || "monthly";
      }
      return next;
    });
  }, [getAuthHeaders]);

  useEffect(() => {
    loadUsers().catch((e) => setMsg(String(e?.message || e)));
  }, [loadUsers]);

  async function createUser() {
    setMsg("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        phone: phone.trim(),
        password,
        role,
        plan,
        billing_cycle: plan === "free" ? null : billing,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: string };
    if (!res.ok || !data.success) throw new Error(data.error || data.detail || `创建失败 ${res.status}`);
    setPhone("");
    setPassword("");
    await loadUsers();
    setMsg("新增成功");
  }

  async function toggleRole(u: AdminUser) {
    const next = u.role === "admin" ? "user" : "admin";
    const res = await fetch("/api/admin/users/role", {
      method: "POST",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ phone: rowKey(u), role: next }),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: string };
    if (!res.ok || !data.success) throw new Error(data.error || data.detail || `设置失败 ${res.status}`);
    await loadUsers();
    setMsg("角色已更新");
  }

  const closeDeleteModal = useCallback(() => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, [deleteBusy]);

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ phone: rowKey(deleteTarget) }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: string };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `删除失败 ${res.status}`);
      await loadUsers();
      setMsg("已删除");
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function saveSubscription(u: AdminUser) {
    const rk = rowKey(u);
    const tier = (rowPlans[rk] ?? u.plan ?? "free").trim().toLowerCase();
    const cycleRaw = rowBilling[rk] ?? u.billing_cycle ?? "monthly";
    const billing_cycle = tier === "free" ? null : String(cycleRaw).toLowerCase();
    setSavingPhone(rk);
    setMsg("");
    try {
      const res = await fetch("/api/admin/users/subscription", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ phone: rk, tier, billing_cycle }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; detail?: string };
      if (!res.ok || !data.success) throw new Error(data.error || data.detail || `保存失败 ${res.status}`);
      await loadUsers();
      setMsg("套餐已更新");
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setSavingPhone(null);
    }
  }

  return (
    <main className="min-h-0 min-w-0 w-full max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink">用户管理</h1>
      <p className="mt-2 text-sm text-muted">新增、删除用户，切换管理员/普通用户，并为用户设置套餐等级。</p>

      <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">新增用户</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-6">
          <input className="rounded bg-canvas p-2 text-sm text-ink" placeholder="手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input
            className="rounded bg-canvas p-2 text-sm text-ink"
            placeholder="密码（≥6 位）"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select className="rounded bg-canvas p-2 text-sm text-ink" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          <select className="rounded bg-canvas p-2 text-sm text-ink" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="free">free</option>
            <option value="basic">basic</option>
            <option value="pro">pro</option>
            <option value="max">max</option>
          </select>
          <select className="rounded bg-canvas p-2 text-sm text-ink" value={billing} onChange={(e) => setBilling(e.target.value)} disabled={plan === "free"}>
            <option value="monthly">monthly</option>
            <option value="yearly">yearly</option>
          </select>
          <button
            className="rounded bg-brand px-3 py-2 text-sm text-brand-foreground hover:bg-brand/90"
            onClick={() => void createUser().catch((e) => setMsg(String(e?.message || e)))}
          >
            新增
          </button>
        </div>
      </section>

      <section className="mt-6 min-w-0 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">用户列表（{users.length}）</h2>
        <p className="mt-1 text-xs text-muted md:hidden">表格较宽，可左右滑动查看全部列。</p>
        <div
          className="mt-3 min-w-0 overflow-x-auto overflow-y-visible overscroll-x-contain [-webkit-overflow-scrolling:touch]"
          role="region"
          aria-label="用户列表，可横向滑动查看"
        >
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-2 py-2">账号</th>
                <th className="px-2 py-2">注册时间</th>
                <th className="px-2 py-2">用户等级</th>
                <th className="px-2 py-2">计费周期</th>
                <th className="px-2 py-2">角色</th>
                <th className="px-2 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={rowKey(u)} className="border-t border-line text-ink">
                  <td className="px-2 py-2 font-mono text-xs">
                    <div className="space-y-0.5">
                      {u.user_id ? <div className="text-[10px] text-muted">id {u.user_id}</div> : null}
                      {u.phone ? <div>{u.phone}</div> : null}
                      {u.email ? <div>{u.email}</div> : null}
                      {u.username ? <div>@{u.username}</div> : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{formatRegisteredAt(u.created_at)}</td>
                  <td className="px-2 py-2">
                    <select
                      className="max-w-[7rem] rounded border border-line bg-canvas px-1.5 py-1 text-xs"
                      value={rowPlans[rowKey(u)] ?? u.plan ?? "free"}
                      onChange={(e) => setRowPlans((m) => ({ ...m, [rowKey(u)]: e.target.value }))}
                    >
                      <option value="free">free</option>
                      <option value="basic">basic</option>
                      <option value="pro">pro</option>
                      <option value="max">max</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      className="max-w-[7rem] rounded border border-line bg-canvas px-1.5 py-1 text-xs"
                      value={rowBilling[rowKey(u)] ?? u.billing_cycle ?? "monthly"}
                      onChange={(e) => setRowBilling((m) => ({ ...m, [rowKey(u)]: e.target.value }))}
                      disabled={(rowPlans[rowKey(u)] ?? u.plan ?? "free") === "free"}
                    >
                      <option value="monthly">monthly</option>
                      <option value="yearly">yearly</option>
                    </select>
                  </td>
                  <td className="px-2 py-2 text-xs">{roleLabel(u.role)}</td>
                  <td className="px-2 py-2">
                    <div className="flex w-max max-w-none flex-nowrap items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded border border-brand/60 px-2 py-1 text-xs text-brand hover:bg-fill disabled:opacity-50"
                        disabled={savingPhone === rowKey(u)}
                        onClick={() => void saveSubscription(u)}
                      >
                        {savingPhone === rowKey(u) ? "保存中…" : "保存套餐"}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-xs"
                        onClick={() => void toggleRole(u).catch((e) => setMsg(String(e?.message || e)))}
                      >
                        切换管理员
                      </button>
                      <button
                        type="button"
                        className="rounded border border-danger/50 px-2 py-1 text-xs text-danger-ink hover:bg-danger-soft dark:border-danger/45 dark:text-danger-ink dark:hover:bg-danger-soft"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(u);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {msg ? <p className="mt-3 text-sm text-muted">{msg}</p> : null}

      <SmallConfirmModal
        open={deleteTarget != null}
        title="确认删除用户"
        message={
          deleteTarget
            ? `确定删除用户「${rowKey(deleteTarget)}」？删除后不可恢复，请谨慎操作。`
            : ""
        }
        confirmLabel="确认删除"
        cancelLabel="取消"
        danger
        busy={deleteBusy}
        busyLabel="删除中…"
        error={deleteError}
        onConfirm={() => void executeDelete()}
        onCancel={closeDeleteModal}
      />
    </main>
  );
}
