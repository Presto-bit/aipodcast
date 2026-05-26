"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import UserErrorBanner from "../../../../../components/ui/UserErrorBanner";
import {
  type AuthorIpItem,
  bootstrapAuthorIpsOnce,
  fetchAuthorIpItem,
  learnAuthorIp,
  trialComposeAuthorIp
} from "../../../../../lib/authorIp";

export default function AuthorIpDetailPage() {
  const params = useParams();
  const ipId = String(params?.ipId || "");
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trialTopic, setTrialTopic] = useState("");
  const [trialBody, setTrialBody] = useState("");
  const [trialBusy, setTrialBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ipId) return;
    setError(null);
    try {
      await bootstrapAuthorIpsOnce();
      const found = await fetchAuthorIpItem(ipId);
      setItem(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setItem(null);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!item && !error) {
    return <p className="p-8 text-sm text-muted">加载中…</p>;
  }

  if (!item) {
    return (
      <>
        <UserErrorBanner message={error || "未找到"} />
        <Link href="/notes/author-ip" className="mt-4 inline-block text-sm text-brand">
          返回列表
        </Link>
      </>
    );
  }

  const profile = item.profile || {};
  const traits = Array.isArray((profile as { traits?: unknown }).traits)
    ? ((profile as { traits: { label?: string; dimension?: string }[] }).traits)
    : [];
  const vitality = (profile as { vitality?: Record<string, unknown> }).vitality || {};

  return (
    <>
      <header className="border-b border-line pb-6">
        <h1 className="text-2xl font-semibold text-ink">概览</h1>
        {item.oneLiner ? <p className="mt-2 text-ink/90">{item.oneLiner}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/notes/author-ip/${item.id}/write`}
            className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
          >
            写一篇
          </Link>
          <Link
            href={`/notes/author-ip/${item.id}/materials`}
            className="rounded-dawn-md border border-line px-4 py-2 text-sm text-ink hover:bg-fill"
          >
            管理素材
          </Link>
          {!item.isReadOnly ? (
            <button
              type="button"
              className="rounded-dawn-md border border-line px-4 py-2 text-sm text-ink hover:bg-fill"
              onClick={() => void learnAuthorIp(item.id).then(() => load())}
            >
              刷新学习
            </button>
          ) : null}
          {item.isTemplate ? (
            <span className="rounded-dawn-md bg-cta/10 px-3 py-2 text-xs text-cta">示例 IP · 只读</span>
          ) : null}
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">概览</h2>
        <p className="mt-2 text-sm text-muted">
          素材 {item.materialCount} 条 · 特色 {item.traitCount} 条 · 绑定笔记本（内部）{" "}
          <code className="text-xs">{item.notebookName}</code>
        </p>
        {Array.isArray(vitality.tagCloud) ? (
          <p className="mt-3 flex flex-wrap gap-2">
            {(vitality.tagCloud as string[]).map((t) => (
              <span key={t} className="rounded-full bg-fill px-2.5 py-0.5 text-xs text-ink">
                {t}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {traits.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">我的特色（节选）</h2>
          <ul className="mt-3 space-y-2">
            {traits.slice(0, 8).map((tr, i) => (
              <li key={`${tr.label}-${i}`} className="rounded-lg border border-line/60 bg-fill/40 px-3 py-2 text-sm">
                <span className="text-muted">{tr.dimension} · </span>
                {tr.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">试写室 · 约 120 字</h2>
        <p className="mt-1 text-xs text-muted">快速验证口吻，满意后再去「写一篇」写长文。</p>
        <input
          className="mt-3 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
          placeholder="试写主题，例如：推荐一款 AI 写作工具"
          value={trialTopic}
          onChange={(e) => setTrialTopic(e.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
            disabled={trialBusy || !trialTopic.trim() || item.isReadOnly}
            onClick={() => {
              setTrialBusy(true);
              setError(null);
              void trialComposeAuthorIp(ipId, { topic: trialTopic.trim() })
                .then((r) => setTrialBody(r.body))
                .catch((e) => setError(e instanceof Error ? e.message : "试写失败"))
                .finally(() => setTrialBusy(false));
            }}
          >
            {trialBusy ? "生成中…" : "试写"}
          </button>
          <Link
            href={`/notes/author-ip/${item.id}/write`}
            className="rounded-dawn-md border border-line px-4 py-2 text-sm text-ink hover:bg-fill"
          >
            去写一篇 →
          </Link>
        </div>
        {trialBody ? (
          <p className="mt-4 whitespace-pre-wrap rounded-lg bg-fill/50 p-3 text-sm text-ink">{trialBody}</p>
        ) : null}
      </section>

      {item.maturity === "empty" ? (
        <section className="mt-8 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-ink">
          建议先在
          <Link href={`/notes/author-ip/${item.id}/write`} className="mx-1 text-brand hover:underline">
            写一篇
          </Link>
          完成约 30 秒的三问冷启动，或到
          <Link href={`/notes/author-ip/${item.id}/materials`} className="mx-1 text-brand hover:underline">
            素材
          </Link>
          添加经历与文章。
        </section>
      ) : null}
    </>
  );
}
