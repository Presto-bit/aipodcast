"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconSparkle } from "../../../../components/icons";
import AuthorIpEducationBanner from "../../../../components/notes/AuthorIpEducationBanner";
import UserErrorBanner from "../../../../components/ui/UserErrorBanner";
import {
  AUTHOR_IP_HOVER_HINT,
  type AuthorIpItem,
  createAuthorIp,
  deleteAuthorIp,
  duplicateAuthorIp,
  fetchAuthorIps
} from "../../../../lib/authorIp";
import { cn } from "../../../../lib/cn";

function maturityLabel(m: string): string {
  const map: Record<string, string> = {
    empty: "待完善",
    sketch: "草图",
    sketch_plus: "草图+",
    ready: "已建立",
    stale: "待学习"
  };
  return map[m] || m;
}

function cardTheme(item: AuthorIpItem): string {
  if (item.isTemplate) {
    return "border-cta/35 bg-gradient-to-br from-cta/[0.08] via-surface to-cta/[0.14]";
  }
  if (item.isSystemSeed) {
    return "border-brand/35 bg-gradient-to-br from-brand/[0.08] via-surface to-brand/[0.14]";
  }
  return "border-line/80 bg-surface";
}

export default function AuthorIpListPage() {
  const router = useRouter();
  const [items, setItems] = useState<AuthorIpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAuthorIps();
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    const name = window.prompt("新 IP 名称", "我的职场号");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const item = await createAuthorIp(name.trim());
      router.push(`/notes/author-ip/${item.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (item: AuthorIpItem) => {
    if (item.isSystemSeed) return;
    if (item.isTemplate) return;
    if (!window.confirm(`删除「${item.displayName}」？素材将进入回收站「个人特色 IP」Tab，可恢复。`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteAuthorIp(item.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const onDuplicate = async (item: AuthorIpItem) => {
    if (
      !window.confirm(
        item.isTemplate
          ? "将复制示例 IP 的全部素材与特色（含文章与经历正文），请随后改成你的真实情况。继续？"
          : "复制该 IP 的全部素材与特色？"
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const copy = await duplicateAuthorIp(item.id);
      router.push(`/notes/author-ip/${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "复制失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">知识库</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">个人特色 IP</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted" title={AUTHOR_IP_HOVER_HINT}>
          {AUTHOR_IP_HOVER_HINT}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            disabled={busy}
            onClick={() => void onCreate()}
          >
            空白新建
          </button>
          <Link
            href="/notes/trash"
            className="rounded-dawn-md border border-line px-4 py-2 text-sm text-ink hover:bg-fill"
          >
            回收站
          </Link>
        </div>
      </header>

      <AuthorIpEducationBanner />

      {error ? <UserErrorBanner className="mb-4" message={error} /> : null}

      {loading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md",
                cardTheme(item)
              )}
            >
              {item.isTemplate ? (
                <span className="absolute right-3 top-3 rounded-full bg-cta/15 px-2 py-0.5 text-xs font-medium text-cta">
                  示例
                </span>
              ) : null}
              {item.isDefault ? (
                <span className="absolute right-3 top-3 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
                  默认
                </span>
              ) : null}
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <IconSparkle width={20} height={20} aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pr-16">
                  <h2 className="truncate text-lg font-semibold text-ink">{item.displayName}</h2>
                  {item.subtitle ? <p className="mt-0.5 truncate text-sm text-muted">{item.subtitle}</p> : null}
                  {item.oneLiner ? <p className="mt-2 line-clamp-2 text-sm text-ink/90">{item.oneLiner}</p> : null}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-fill/80 py-2">
                  <dt className="text-muted">状态</dt>
                  <dd className="mt-0.5 font-medium text-ink">{maturityLabel(String(item.maturity))}</dd>
                </div>
                <div className="rounded-lg bg-fill/80 py-2">
                  <dt className="text-muted">素材</dt>
                  <dd className="mt-0.5 font-medium text-ink">{item.materialCount}</dd>
                </div>
                <div className="rounded-lg bg-fill/80 py-2">
                  <dt className="text-muted">特色</dt>
                  <dd className="mt-0.5 font-medium text-ink">{item.traitCount}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/notes/author-ip/${item.id}`}
                  className="rounded-dawn-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90"
                >
                  进入
                </Link>
                <Link
                  href={`/notes/author-ip/${item.id}/write`}
                  className="rounded-dawn-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-fill"
                >
                  写一篇
                </Link>
                <button
                  type="button"
                  className="rounded-dawn-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-fill disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void onDuplicate(item)}
                >
                  复制并新建
                </button>
                {!item.isSystemSeed && !item.isTemplate ? (
                  <button
                    type="button"
                    className="rounded-dawn-md border border-danger/40 px-3 py-1.5 text-sm text-danger-ink hover:bg-danger-soft disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void onDelete(item)}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              {item.isTemplate ? (
                <p className="mt-3 text-xs text-muted">虚构示范数据，不会用于你的真实写作，除非复制后自行修改。</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
