"use client";

import Link from "next/link";

export default function AdminHubPage() {
  return (
    <main className="min-h-0 max-w-5xl">
      <h1 className="mt-4 text-2xl font-semibold text-ink">后台管理</h1>
      <p className="mt-2 text-sm text-muted">管理入口已调整为左侧导航，请从左侧选择功能模块。</p>

      <section className="mt-8 rounded-xl border border-line bg-surface/60 p-5">
        <h2 className="text-base font-semibold text-ink">常用操作</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link href="/admin/usage" className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm text-ink hover:bg-fill">
            打开数据看板
          </Link>
          <Link href="/admin/jobs" className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm text-ink hover:bg-fill">
            打开创作记录
          </Link>
          <Link
            href="/admin/subscription-matrix"
            className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm text-ink hover:bg-fill"
          >
            订阅与权限矩阵
          </Link>
          <Link
            href="/admin/subscription-pay"
            className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm text-ink hover:bg-fill"
          >
            订阅收银（内测）
          </Link>
          <Link href="/" className="text-sm text-brand hover:text-brand/80">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  );
}
