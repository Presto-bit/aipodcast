"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth";

type MatrixRow = {
  key: string;
  label: string;
  [tier: string]: string | undefined;
};

type MatrixSection = {
  id: string;
  title: string;
  rows: MatrixRow[];
};

type MatrixPayload = {
  success?: boolean;
  version?: string;
  manifest_version?: string;
  tier_keys?: string[];
  tier_labels?: Record<string, string>;
  sections?: MatrixSection[];
  helpers?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  detail?: string;
  error?: string;
};

const DEFAULT_COL_KEYS = ["free", "basic", "pro", "max", "payg"] as const;

export default function AdminSubscriptionMatrixPage() {
  const { getAuthHeaders } = useAuth();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/entitlement-matrix", { headers: getAuthHeaders(), cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as MatrixPayload;
      if (!res.ok || json.success === false) {
        throw new Error(json.detail || json.error || `加载失败 ${res.status}`);
      }
      setData(json);
    } catch (e) {
      setData(null);
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = data?.tier_labels || {
    free: "Free",
    basic: "Basic",
    pro: "Pro",
    max: "Creator（max）",
    payg: "按次"
  };

  const colKeys =
    Array.isArray(data?.tier_keys) && data.tier_keys.length > 0 ? data.tier_keys : [...DEFAULT_COL_KEYS];

  return (
    <main className="min-h-0 max-w-6xl">
      <h1 className="mt-4 text-2xl font-semibold text-ink">订阅与权限矩阵</h1>
      <p className="mt-2 text-sm text-muted">
        本页仅管理员可见。权益数值与价目统一来自编排器{" "}
        <code className="rounded bg-fill px-1 font-mono text-xs">subscription_manifest</code>
        （矩阵展示由 <code className="rounded bg-fill px-1 font-mono text-xs">entitlement_matrix</code>{" "}
        派生），与套餐 API、用量口径一致。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-line bg-canvas/60 px-3 py-1.5 text-sm text-ink hover:bg-fill disabled:opacity-50"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "刷新中…" : "重新加载"}
        </button>
        {data?.version ? (
          <span className="text-xs text-muted">
            矩阵 <span className="font-mono text-ink">{data.version}</span>
            {data.manifest_version ? (
              <>
                {" "}
                · manifest <span className="font-mono text-ink">{data.manifest_version}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>

      {err ? (
        <p className="mt-4 text-sm text-danger-ink" role="alert">
          {err}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="mt-8 text-sm text-muted">加载中…</p>
      ) : null}

      {data?.helpers ? (
        <section className="mt-8 rounded-xl border border-line bg-surface/50 p-4">
          <h2 className="text-sm font-semibold text-ink">数值助手（按档位）</h2>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs text-ink">{JSON.stringify(data.helpers, null, 2)}</pre>
        </section>
      ) : null}

      {data?.pricing ? (
        <section className="mt-8 rounded-xl border border-line bg-surface/50 p-4">
          <h2 className="text-sm font-semibold text-ink">价目（subscription_manifest）</h2>
          <p className="mt-1 text-xs text-muted">金额单位为分（fen），与 /api/v1/subscription/plans 同源。</p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-canvas p-3 text-xs text-ink">{JSON.stringify(data.pricing, null, 2)}</pre>
        </section>
      ) : null}

      {data?.sections?.map((sec) => (
        <section key={sec.id} className="mt-8">
          <h2 className="text-base font-semibold text-ink">{sec.title}</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface/40">
            <table className="min-w-[720px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-fill/50 text-xs text-muted">
                  <th className="sticky left-0 z-[1] min-w-[12rem] bg-fill/95 px-3 py-2 font-medium">开关键 / 说明</th>
                  {colKeys.map((k) => (
                    <th key={k} className="px-3 py-2 font-medium">
                      {labels[k] ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row) => (
                  <tr key={row.key} className="border-t border-line/80">
                    <td className="sticky left-0 z-[1] bg-surface/95 px-3 py-2 align-top">
                      <div className="font-medium text-ink">{row.label}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted">{row.key}</div>
                    </td>
                    {colKeys.map((k) => (
                      <td key={k} className="max-w-[14rem] whitespace-pre-wrap px-3 py-2 text-xs text-ink">
                        {String(row[k] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {!loading && !err && !data?.sections?.length ? (
        <p className="mt-8 text-sm text-muted">暂无矩阵数据。</p>
      ) : null}
    </main>
  );
}
