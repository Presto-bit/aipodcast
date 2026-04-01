import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-4xl font-semibold text-muted">404</p>
      <p className="text-sm text-muted">未找到该页面。请从首页进入，或检查地址是否含多余路径（例如 /zh/app/…）。</p>
      <Link href="/" className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand">
        返回首页
      </Link>
    </div>
  );
}
