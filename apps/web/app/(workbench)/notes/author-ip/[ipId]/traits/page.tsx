"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import UserErrorBanner from "../../../../../../components/ui/UserErrorBanner";
import { type AuthorIpItem, fetchAuthorIpItem, learnAuthorIp } from "../../../../../../lib/authorIp";

type TraitRow = {
  dimension?: string;
  label?: string;
  evidence?: string;
  defaultOn?: boolean;
};

export default function AuthorIpTraitsPage() {
  const params = useParams();
  const ipId = String(params?.ipId || "");
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [traits, setTraits] = useState<TraitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ipId) return;
    setLoading(true);
    try {
      const found = await fetchAuthorIpItem(ipId);
      setItem(found);
      const prof = found.profile as { traits?: TraitRow[] };
      setTraits(Array.isArray(prof.traits) ? prof.traits : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">我的特色</h1>
          <p className="mt-1 text-sm text-muted">成文时默认启用的表达特征；「像/不像」反馈将逐步优化权重。</p>
        </div>
        {!item?.isReadOnly ? (
          <button
            type="button"
            className="rounded-dawn-md border border-line px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void learnAuthorIp(ipId)
                .then(load)
                .catch((e) => setError(e instanceof Error ? e.message : "失败"))
                .finally(() => setBusy(false));
            }}
          >
            从素材刷新
          </button>
        ) : null}
      </header>

      {error ? <UserErrorBanner className="mt-4" message={error} /> : null}

      {loading ? (
        <p className="mt-6 text-sm text-muted">加载中…</p>
      ) : traits.length === 0 ? (
        <p className="mt-6 text-sm text-muted">完成冷启动或添加素材后，学习引擎会生成特色条目。</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {traits.map((tr, i) => (
            <li key={`${tr.label}-${i}`} className="rounded-xl border border-line bg-fill/30 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-muted">{tr.dimension || "特色"} · </span>
                  {tr.label}
                </span>
                {tr.defaultOn === false ? (
                  <span className="text-xs text-muted">默认关</span>
                ) : (
                  <span className="text-xs text-brand">默认开</span>
                )}
              </div>
              {tr.evidence ? <p className="mt-1 text-xs text-muted">{tr.evidence}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
