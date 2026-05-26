"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconSparkle, MoreHorizontal, Plus } from "../../../../components/icons";
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
  fetchAuthorIps,
  patchAuthorIp
} from "../../../../lib/authorIp";
import { cn } from "../../../../lib/cn";

const GRID_CLASS = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";
const USER_CARD_SURFACE =
  "border-brand/30 bg-gradient-to-br from-brand/[0.06] via-surface to-brand/[0.1] hover:border-brand/40";

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

function sortExtraUserIps(list: AuthorIpItem[]): AuthorIpItem[] {
  return [...list].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
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
  menuOpen,
  onMenuToggle,
  onRename,
  onDuplicate,
  onDelete
}: {
  item: AuthorIpItem;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onRename: (item: AuthorIpItem) => void;
  onDuplicate: (item: AuthorIpItem) => void;
  onDelete: (item: AuthorIpItem) => void;
}) {
  const canDelete = !item.isSystemSeed && !item.isTemplate;
  const canRename = !item.isTemplate;

  return (
    <li
      className={cn(
        "group relative flex min-h-[148px] flex-col rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md",
        USER_CARD_SURFACE
      )}
    >
      {item.isDefault && !item.isTemplate ? (
        <span className="absolute left-2 top-2 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand">
          默认
        </span>
      ) : null}
      <div className="absolute right-2 top-2 z-10">
        <span className="relative flex" data-author-ip-card-menu>
          <button
            type="button"
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink disabled:opacity-50"
            aria-label="更多操作"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMenuToggle();
            }}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 top-full z-20 mt-0.5 min-w-[7rem] rounded-md border border-line bg-surface py-0.5 text-[11px] shadow-card"
              role="menu"
            >
              {canRename ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(item);
                  }}
                >
                  改名
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="block w-full px-2 py-1.5 text-left hover:bg-fill"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(item);
                }}
              >
                复制
              </button>
              {canDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-2 py-1.5 text-left text-danger-ink hover:bg-danger-soft"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item);
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
          ) : null}
        </span>
      </div>
      <Link
        href={`/notes/author-ip/${item.id}`}
        className="flex flex-1 flex-col items-center justify-center px-6 pt-2 text-center"
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
    </li>
  );
}

function GridSkeleton({ withCreate }: { withCreate?: boolean }) {
  return (
    <ul className={GRID_CLASS} aria-busy="true" aria-label="加载中">
      {withCreate ? (
        <li className="min-h-[148px] animate-pulse rounded-2xl border-2 border-dashed border-line/60 bg-fill/40" />
      ) : null}
      <li className="min-h-[148px] animate-pulse rounded-2xl border border-line bg-fill/60" />
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
  const [menuIpId, setMenuIpId] = useState<string | null>(null);
  const [renameItem, setRenameItem] = useState<AuthorIpItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const { myIp, extraUserIps, exampleIps } = useMemo(() => {
    const examples = items.filter((i) => i.isTemplate);
    const system =
      items.find((i) => i.isSystemSeed && !i.isTemplate) ??
      items.find((i) => i.isDefault && !i.isTemplate) ??
      null;
    const extra = sortExtraUserIps(items.filter((i) => !i.isTemplate && !i.isSystemSeed));
    return { myIp: system, extraUserIps: extra, exampleIps: examples };
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

  useEffect(() => {
    if (!menuIpId) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-author-ip-card-menu]")) return;
      setMenuIpId(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuIpId]);

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

  const openRename = (item: AuthorIpItem) => {
    setMenuIpId(null);
    setRenameItem(item);
    setRenameName(item.displayName);
    setRenameError(null);
  };

  const submitRename = async () => {
    if (!renameItem) return;
    const name = renameName.trim();
    if (!name) {
      setRenameError("请填写名称");
      return;
    }
    setBusy(true);
    setRenameError(null);
    try {
      await patchAuthorIp(renameItem.id, { displayName: name });
      setRenameItem(null);
      await load();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "改名失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (item: AuthorIpItem) => {
    setMenuIpId(null);
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
    setMenuIpId(null);
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

  const renderCard = (item: AuthorIpItem) => (
    <AuthorIpGridCard
      key={item.id}
      item={item}
      busy={busy}
      menuOpen={menuIpId === item.id}
      onMenuToggle={() => setMenuIpId((id) => (id === item.id ? null : item.id))}
      onRename={openRename}
      onDuplicate={(i) => void onDuplicate(i)}
      onDelete={(i) => void onDelete(i)}
    />
  );

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
          <GridSkeleton withCreate />
        ) : (
          <ul className={GRID_CLASS}>
            <CreateIpCard disabled={busy} onClick={openCreate} />
            {myIp ? renderCard(myIp) : null}
            {extraUserIps.map((item) => renderCard(item))}
          </ul>
        )}
        {!loading && !myIp ? (
          <p className="mt-3 text-sm text-muted">正在初始化「我的 IP」…</p>
        ) : null}
      </section>

      <div className="my-8 border-t border-line" role="separator" />

      <section aria-label="示例 IP">
        <h2 className="text-sm font-semibold text-ink">示例 IP</h2>
        <p className="mt-1 text-xs text-muted">系统预设示例，可复制后改成你的真实情况。</p>
        <div className="mt-4">
          {loading ? (
            <GridSkeleton />
          ) : exampleIps.length === 0 ? (
            <p className="text-sm text-muted">系统示例加载中或暂不可用，请刷新后重试。</p>
          ) : (
            <ul className={GRID_CLASS}>{exampleIps.map((item) => renderCard(item))}</ul>
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

      <SmallPromptModal
        open={Boolean(renameItem)}
        title="改名"
        value={renameName}
        onChange={setRenameName}
        placeholder="IP 名称"
        submitLabel="保存"
        busy={busy}
        error={renameError}
        onCancel={() => {
          if (!busy) setRenameItem(null);
        }}
        onSubmit={() => void submitRename()}
      />
    </div>
  );
}
