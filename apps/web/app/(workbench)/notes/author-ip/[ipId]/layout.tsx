"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AuthorIpSubNav from "../../../../../components/notes/AuthorIpSubNav";
import { type AuthorIpItem, fetchAuthorIps } from "../../../../../lib/authorIp";

export default function AuthorIpLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const ipId = String(params?.ipId || "");
  const [item, setItem] = useState<AuthorIpItem | null>(null);

  const load = useCallback(async () => {
    if (!ipId) return;
    try {
      const list = await fetchAuthorIps();
      setItem(list.find((x) => x.id === ipId) ?? null);
    } catch {
      setItem(null);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <AuthorIpSubNav displayName={item?.displayName} />
      {children}
    </div>
  );
}
