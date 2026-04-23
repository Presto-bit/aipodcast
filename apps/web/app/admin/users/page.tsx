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
  acct_tier?: string;
  billing_cycle?: string | null;
  has_password?: boolean;
  created_at?: number;
  email_verified?: boolean;
  wallet_balance_cents?: number;
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

function formatWalletYuan(cents: number | undefined) {
  const c = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return (c / 100).toFixed(2);
}

export default function AdminUsersPage() {
  const { getAuthHeaders } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [msg, setMsg] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [creditYuanByPhone, setCreditYuanByPhone] = useState<Record<string, string>>({});
  const [creditBusyPhone, setCreditBusyPhone] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", { headers: getAuthHeaders(), cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; users?: AdminUser[]; error?: string; detail?: string };
    if (!res.ok || !data.success) throw new Error(data.error || data.detail || `加载失败 ${res.status}`);
    const list = data.users || [];
    setUsers(list);
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
        acct_tier: "free",
        billing_cycle: null,
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

  async function creditWallet(target: AdminUser) {
    const phoneKey = rowKey(target);
    const raw = (creditYuanByPhone[phoneKey] || "").trim();
    const yuan = Number.parseFloat(raw);
    if (!Number.isFinite(yuan) || yuan <= 0) {
      setMsg("请输入大于 0 的充值金额（元）");
      return;
    }
    const cents = Math.round(yuan * 100);
    if (cents < 1) {
      setMsg("金额过小");
      return;
    }
    setCreditBusyPhone(phoneKey);
    setMsg("");
    try {
      const res = await fetch("/api/admin/users/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ phone: phoneKey, amount_cents: cents }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        detail?: string;
        error?: string;
        wallet_balance_cents?: number;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `充值失败 ${res.status}`);
      }
      setCreditYuanByPhone((prev) => ({ ...prev, [phoneKey]: "" }));
      setMsg(`已充值 ¥${(cents / 100).toFixed(2)}，当前余额 ¥${((data.wallet_balance_cents ?? 0) / 100).toFixed(2)}`);
      await loadUsers();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setCreditBusyPhone(null);
    }
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

  return (
    <main className="min-h-0 min-w-0 w-full max-w-6xl">
      <h1 className="text-2xl font-semibold text-ink">用户管理</h1>
      <p className="mt-2 text-sm text-muted">
        新增、删除用户，切换管理员/普通用户；可为已存在用户增加钱包余额（不入订单表，仅调账）。计费与体验包由产品策略统一管理。
      </p>

      <section className="mt-6 rounded-xl border border-line bg-surface/60 p-4">
        <h2 className="text-sm font-medium text-ink">新增用户</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-6">
          <input
            className="rounded bg-canvas p-2 text-sm text-ink"
            placeholder="手机号"
            name="fym-admin-new-user-phone"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <input
            className="rounded bg-canvas p-2 text-sm text-ink"
            placeholder="密码（≥6 位）"
            type="password"
            name="fym-admin-new-user-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <select className="rounded bg-canvas p-2 text-sm text-ink" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
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
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-2 py-2">账号</th>
                <th className="px-2 py-2">钱包余额</th>
                <th className="px-2 py-2">注册时间</th>
                <th className="px-2 py-2">角色</th>
                <th className="px-2 py-2">档位</th>
                <th className="px-2 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-muted">
                    暂无用户
                  </td>
                </tr>
              ) : null}
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
                  <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-ink">¥{formatWalletYuan(u.wallet_balance_cents)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">{formatRegisteredAt(u.created_at)}</td>
                  <td className="px-2 py-2 text-xs">{roleLabel(u.role)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted">
                    {(u.acct_tier || "free").toLowerCase()}
                    {u.billing_cycle ? ` · ${u.billing_cycle}` : ""}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex w-max max-w-none flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <div className="flex flex-wrap items-center gap-1">
                        <input
                          className="w-24 rounded border border-line bg-canvas px-2 py-1 text-xs text-ink"
                          inputMode="decimal"
                          placeholder="金额"
                          aria-label={`为 ${rowKey(u)} 充值金额（元）`}
                          value={creditYuanByPhone[rowKey(u)] ?? ""}
                          onChange={(e) =>
                            setCreditYuanByPhone((prev) => ({ ...prev, [rowKey(u)]: e.target.value }))
                          }
                        />
                        <span className="text-[10px] text-muted">元</span>
                        <button
                          type="button"
                          className="rounded bg-brand px-2 py-1 text-xs text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
                          disabled={creditBusyPhone === rowKey(u)}
                          onClick={() => void creditWallet(u)}
                        >
                          {creditBusyPhone === rowKey(u) ? "充值中…" : "加余额"}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
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
