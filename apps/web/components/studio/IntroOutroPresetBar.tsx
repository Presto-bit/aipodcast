"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntroOutroSnapshotV1 } from "../../lib/introOutroSnapshot";
import {
  addIntroOutroNamed,
  listIntroOutroNamed,
  removeIntroOutroNamed,
  type IntroOutroScope
} from "../../lib/introOutroStorage";

type IntroOutroPresetBarProps = {
  scope: IntroOutroScope;
  buildSnapshot: () => Promise<IntroOutroSnapshotV1>;
  onApplySnapshot: (snap: IntroOutroSnapshotV1) => void;
};

export default function IntroOutroPresetBar({ scope, buildSnapshot, onApplySnapshot }: IntroOutroPresetBarProps) {
  const [nameInput, setNameInput] = useState("");
  const [msg, setMsg] = useState("");
  const [listEpoch, setListEpoch] = useState(0);

  const named = useMemo(() => listIntroOutroNamed(scope), [scope, listEpoch]);

  const bump = useCallback(() => setListEpoch((n) => n + 1), []);

  useEffect(() => {
    const onFocus = () => bump();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [bump]);

  async function onSaveNamed() {
    setMsg("");
    const label = nameInput.trim() || window.prompt("预设名称", "我的开场结尾")?.trim();
    if (!label) return;
    try {
      const snap = await buildSnapshot();
      addIntroOutroNamed(scope, label, snap);
      setNameInput("");
      setMsg("已保存预设");
      bump();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-line bg-fill/60 p-3">
      <p className="text-xs font-medium text-ink">本地预设</p>

      <label className="mt-2 block text-xs text-muted">
        应用已存预设
        <select
          className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm"
          aria-label="选择已保存的开场结尾预设"
          defaultValue=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const row = named.find((x) => x.id === id);
            if (row) {
              const { id: _i, label: _l, createdAt: _c, ...snap } = row;
              onApplySnapshot(snap);
              setMsg(`已应用：${row.label}`);
            }
            e.target.value = "";
          }}
        >
          <option value="">选择一项…</option>
          {named.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="min-w-[8rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="新预设名称（可选）"
        />
        <button
          type="button"
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-fill"
          onClick={() => void onSaveNamed()}
        >
          保存当前为预设
        </button>
      </div>

      {named.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <label className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted">
            删除预设
            <select
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-1.5 text-xs"
              aria-label="选择要删除的预设"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                if (window.confirm("删除该预设？")) {
                  removeIntroOutroNamed(scope, id);
                  bump();
                  setMsg("已删除");
                }
                e.target.value = "";
              }}
            >
              <option value="">选择…</option>
              {named.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {msg ? <p className="mt-2 text-[11px] text-muted">{msg}</p> : null}
    </div>
  );
}
