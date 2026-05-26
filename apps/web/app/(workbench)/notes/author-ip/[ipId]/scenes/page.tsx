"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import UserErrorBanner from "../../../../../../components/ui/UserErrorBanner";
import {
  type AuthorIpDomain,
  type AuthorIpItem,
  fetchAuthorIpItem,
  patchAuthorIpDomains
} from "../../../../../../lib/authorIp";

export default function AuthorIpScenesPage() {
  const params = useParams();
  const ipId = String(params?.ipId || "");
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [domains, setDomains] = useState<AuthorIpDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!ipId) return;
    setLoading(true);
    try {
      const found = await fetchAuthorIpItem(ipId);
      setItem(found);
      const prof = found.profile as { domains?: AuthorIpDomain[] };
      setDomains(Array.isArray(prof.domains) ? prof.domains : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await patchAuthorIpDomains(ipId, domains);
      setItem(updated);
      const prof = updated.profile as { domains?: AuthorIpDomain[] };
      setDomains(Array.isArray(prof.domains) ? prof.domains : []);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const addScene = () => {
    setDomains((xs) => [...xs, { displayName: `场景 ${xs.length + 1}`, boundArticleTitles: [] }]);
  };

  return (
    <>
      <header>
        <h1 className="text-xl font-semibold text-ink">场景</h1>
        <p className="mt-1 text-sm text-muted">
          写作时 Resolver 会按主题匹配场景口吻；可改显示名称，绑定关系来自素材标题。
        </p>
      </header>

      {error ? <UserErrorBanner className="mt-4" message={error} /> : null}
      {saved ? <p className="mt-2 text-xs text-brand">已保存</p> : null}

      {loading ? (
        <p className="mt-6 text-sm text-muted">加载中…</p>
      ) : (
        <div className="mt-6 space-y-4">
          {domains.length === 0 ? (
            <p className="text-sm text-muted">暂无场景，添加素材或学习后会自动生成。</p>
          ) : (
            domains.map((dom, idx) => (
              <div key={`scene-${idx}`} className="rounded-xl border border-line bg-surface p-4">
                <label className="text-xs font-medium text-muted">场景名称</label>
                <input
                  className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm disabled:opacity-60"
                  value={dom.displayName || ""}
                  disabled={Boolean(item?.isReadOnly)}
                  onChange={(e) =>
                    setDomains((xs) =>
                      xs.map((d, i) => (i === idx ? { ...d, displayName: e.target.value } : d))
                    )
                  }
                />
                {dom.boundArticleTitles?.length ? (
                  <p className="mt-2 text-xs text-muted">
                    绑定文章：{dom.boundArticleTitles.slice(0, 4).join(" · ")}
                  </p>
                ) : null}
                {dom.boundExperienceTemplates?.length ? (
                  <p className="mt-1 text-xs text-muted">
                    绑定经历模板：{dom.boundExperienceTemplates.join(" · ")}
                  </p>
                ) : null}
              </div>
            ))
          )}
          {!item?.isReadOnly ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-dawn-md border border-line px-3 py-1.5 text-sm"
                onClick={addScene}
              >
                添加场景
              </button>
              <button
                type="button"
                className="rounded-dawn-md bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void onSave()}
              >
                {busy ? "保存中…" : "保存场景"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted">示例 IP 场景为只读。</p>
          )}
        </div>
      )}
    </>
  );
}
