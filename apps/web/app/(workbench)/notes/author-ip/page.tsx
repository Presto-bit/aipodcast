"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSparkle, Plus } from "../../../../components/icons";
import AuthorIpEducationBanner from "../../../../components/notes/AuthorIpEducationBanner";
import SmallPromptModal from "../../../../components/ui/SmallPromptModal";
import UserErrorBanner from "../../../../components/ui/UserErrorBanner";
import {
  AUTHOR_IP_HOVER_HINT,
  type AuthorIpItem,
  bootstrapAuthorIpsOnce,
  createAuthorIp,
  deleteAuthorIp,
  duplicateAuthorIp,
  fetchAuthorIps
} from "../../../../lib/authorIp";
import { cn } from "../../../../lib/cn";

const GRID_CLASS = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

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

function cardSurface(item: AuthorIpItem): string {
  if (item.isTemplate) {
    return "border-cta/35 bg-gradient-to-br from-cta/[0.06] via-surface to-cta/[0.12]";
  }
  if (item.isSystemSeed) {
    return "border-brand/30 bg-gradient-to-br from-brand/[0.06] via-surface to-brand/[0.1]";
  }
  return "border-line/80 bg-surface hover:border-brand/30";
}

function sortUserIps(list: AuthorIpItem[]): AuthorIpItem[] {
  return [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isSystemSeed !== b.isSystemSeed) return a.isSystemSeed ? -1 : 1;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function CreateIpCard({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-[148px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line/90 bg-fill/15 px-3 py-6 text-center transition hover:border-brand/40 hover:bg-fill/30 disabled:opacity-50"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Plus className="h-6 w-6" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="text-sm font-medium text-ink">新建 IP</span>
      </button>
    </li>
  );
}

function AuthorIpGridCard({
  item,
  busy,
  onDelete,
  onDuplicate
}: {
  item: AuthorIpItem;
  busy: boolean;
  onDelete: (item: AuthorIpItem) => void;
  onDuplicate: (item: AuthorIpItem) => void;
}) {
  const canDelete = !item.isSystemSeed && !item.isTemplate;

  return (
    <li
      className={cn(
        "group relative flex min-h-[148px] flex-col rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        cardSurface(item)
      )}
    >
      {item.isDefault ? (
        <span className="absolute right-2 top-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand">
          默认
        </span>
      ) : null}
      <Link
        href={`/notes/author-ip/${item.id}`}
        className="flex flex-1 flex-col items-center justify-center text-center"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <IconSparkle width={22} height={22} aria-hidden />
        </span>
        <h2 className="mt-3 line-clamp-2 w-full text-sm font-semibold text-ink">{item.displayName}</h2>
        {item.subtitle ? (
          <p className="mt-1 line-clamp-1 w-full text-xs text-muted">{item.subtitle}</p>
        ) : (
          <p className="mt-1 text-xs text-muted">{maturityLabel(String(item.maturity))}</p>
        )}
      </Link>
      <div className="mt-3 flex flex-wrap justify-center gap-1 border-t border-line/60 pt-2">
        <Link
          href={`/notes/author-ip/${item.id}/write`}
          className="rounded px-2 py-0.5 text-[11px] text-brand hover:bg-brand/10"
          onClick={(e) => e.stopPropagation()}
        >
          写一篇
        </Link>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[11px] text-ink hover:bg-fill disabled:opacity-50"
          disabled={busy}
          onClick={() => onDuplicate(item)}
        >
          复制
        </button>
        {canDelete ? (
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-danger-ink hover:bg-danger-soft disabled:opacity-50"
            disabled={busy}
            onClick={() => onDelete(item)}
          >
            删除
          </button>
        ) : null}
      </div>
    </li>
  );
}

function GridSkeleton() {
  return (
    <ul className={GRID_CLASS} aria-busy="true" aria-label="加载中">
      <li className="min-h-[148px] animate-pulse rounded-2xl border-2 border-dashed border-line/60 bg-fill/40" />
      {[0, 1, 2].map((i) => (
        <li key={i} className="min-h-[148px] animate-pulse rounded-2xl border border-line bg-fill/60" />
      ))}
    </ul>
  );
}

export default function AuthorIpListPage() {
  const router = useRouter();
  const [items, setItems] = useState<AuthorIpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("我的职场号");
  const [createError, setCreateError] = useState<string | null>(null);

  const { userIps, exampleIps } = useMemo(() => {
    const examples = items.filter((i) => i.isTemplate);
    const users = sortUserIps(items.filter((i) => !i.isTemplate));
    return { userIps: users, exampleIps: examples };
  }, [items]);

  const load = useCallback(async () => {
    setError(null);
    try {
      await bootstrapAuthorIpsOnce();
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

  const openCreate = () => {
    setCreateName("我的职场号");
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const name = createName.trim();
    if (!name) {
      setCreateError("请填写名称");
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const item = await createAuthorIp(name);
      setCreateOpen(false);
      router.push(`/notes/author-ip/${item.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (item: AuthorIpItem) => {
    if (item.isSystemSeed || item.isTemplate) return;
    if (!window.confirm(`删除「${item.displayName}」？可在知识库一级导航的「回收站」中恢复。`)) {
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">
          <Link href="/notes" className="text-muted transition hover:text-brand">
            知识库
          </Link>
          <span className="mx-2 font-normal text-muted" aria-hidden>
            |
          </span>
          <span>个人风格 IP</span>
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{AUTHOR_IP_HOVER_HINT}</p>
      </header>

      <AuthorIpEducationBanner />

      {error ? <UserErrorBanner className="mb-4" message={error} /> : null}

      <section aria-label="我的 IP">
        {loading ? (
          <GridSkeleton />
        ) : (
          <ul className={GRID_CLASS}>
            <CreateIpCard disabled={busy} onClick={openCreate} />
            {userIps.map((item) => (
              <AuthorIpGridCard
                key={item.id}
                item={item}
                busy={busy}
                onDelete={(i) => void onDelete(i)}
                onDuplicate={(i) => void onDuplicate(i)}
              />
            ))}
          </ul>
        )}
        {!loading && userIps.length === 0 ? (
          <p className="mt-3 text-sm text-muted">暂无个人 IP，点击「新建 IP」开始创建。</p>
        ) : null}
      </section>

      <div className="my-8 border-t border-line" role="separator" />

      <section aria-label="示例 IP" className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <h2 className="shrink-0 text-sm font-semibold text-ink sm:w-16 sm:pt-2">示例 IP</h2>
        <div className="min-w-0 flex-1">
          {loading ? (
            <ul className={GRID_CLASS} aria-busy="true">
              <li className="min-h-[148px] animate-pulse rounded-2xl border border-cta/20 bg-fill/60" />
            </ul>
          ) : exampleIps.length === 0 ? (
            <p className="text-sm text-muted">系统示例加载中或暂不可用，请刷新后重试。</p>
          ) : (
            <>
              <ul className={GRID_CLASS}>
                {exampleIps.map((item) => (
                  <AuthorIpGridCard
                    key={item.id}
                    item={item}
                    busy={busy}
                    onDelete={(i) => void onDelete(i)}
                    onDuplicate={(i) => void onDuplicate(i)}
                  />
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">系统预设示例，可复制后改成你的真实情况。</p>
            </>
          )}
        </div>
      </section>

      <SmallPromptModal
        open={createOpen}
        title="新建 IP"
        value={createName}
        onChange={setCreateName}
        placeholder="例如：我的职场号"
        submitLabel="创建"
        busy={busy}
        error={createError}
        onCancel={() => {
          if (!busy) setCreateOpen(false);
        }}
        onSubmit={() => void submitCreate()}
      />
    </div>
  );
}
