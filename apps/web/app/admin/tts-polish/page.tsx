"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth";

type PromptsPayload = {
  success?: boolean;
  defaults?: { dual?: string; single?: string };
  effective_dual?: string;
  effective_single?: string;
  error?: string;
  detail?: string;
};

export default function AdminTtsPolishPage() {
  const { getAuthHeaders } = useAuth();
  const [dual, setDual] = useState("");
  const [single, setSingle] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/tts-polish-prompts", { headers: getAuthHeaders(), cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as PromptsPayload & { detail?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `加载失败 ${res.status}`);
      }
      setDual(String(data.effective_dual ?? ""));
      setSingle(String(data.effective_single ?? ""));
    } catch (e) {
      setDual("");
      setSingle("");
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/tts-polish-prompts", {
        method: "PUT",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ dual_requirements: dual, single_requirements: single })
      });
      const data = (await res.json().catch(() => ({}))) as PromptsPayload & { detail?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `保存失败 ${res.status}`);
      }
      setDual(String(data.effective_dual ?? dual));
      setSingle(String(data.effective_single ?? single));
      setMsg("已保存");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm("确定恢复为代码内置默认条款？将清除数据库中的覆盖内容。")) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/tts-polish-prompts/reset", {
        method: "POST",
        headers: getAuthHeaders()
      });
      const data = (await res.json().catch(() => ({}))) as PromptsPayload & { detail?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `恢复失败 ${res.status}`);
      }
      setDual(String(data.effective_dual ?? ""));
      setSingle(String(data.effective_single ?? ""));
      setMsg("已恢复默认");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-0 max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">TTS 润色条款</h1>
      <p className="mt-2 text-sm text-muted">
        此处为进入语音合成前、调用文本模型时的<strong>「要求」</strong>编号条款（双人须保留 Speaker1/Speaker2
        行格式说明）。保存后即时作用于编排器与 Worker；未覆盖时使用代码内置默认。
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => void save()}
        >
          保存
        </button>
        <button
          type="button"
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-fill disabled:opacity-50"
          disabled={busy}
          onClick={() => void load()}
        >
          重新加载
        </button>
        <button
          type="button"
          className="rounded-lg border border-amber-600/50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void reset()}
        >
          恢复默认
        </button>
      </div>

      {msg ? <p className="mt-3 text-sm text-emerald-600">{msg}</p> : null}
      {err ? <p className="mt-3 text-sm text-rose-500">{err}</p> : null}

      <div className="mt-6 space-y-6">
        <label className="block">
          <span className="text-sm font-medium text-ink">双人对话润色 · 要求条款</span>
          <textarea
            className="mt-2 min-h-[200px] w-full rounded-xl border border-line bg-canvas p-3 font-mono text-sm leading-relaxed text-ink"
            value={dual}
            onChange={(e) => setDual(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">单人播讲润色 · 要求条款</span>
          <textarea
            className="mt-2 min-h-[200px] w-full rounded-xl border border-line bg-canvas p-3 font-mono text-sm leading-relaxed text-ink"
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            spellCheck={false}
          />
        </label>
      </div>
    </main>
  );
}
