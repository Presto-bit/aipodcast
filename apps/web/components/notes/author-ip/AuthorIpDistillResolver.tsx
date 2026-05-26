"use client";

import { useState } from "react";
import { Button } from "../../ui/Button";
import { resolveAuthorIpStyle, type AuthorIpResolver } from "../../../lib/authorIp";

type Props = {
  ipId: string;
  disabled?: boolean;
};

export default function AuthorIpDistillResolver({ ipId, disabled }: Props) {
  const [topic, setTopic] = useState("测一款新的 AI 工具值不值得开会员");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<AuthorIpResolver | null>(null);

  const onResolve = async () => {
    const t = topic.trim();
    if (!t) {
      setError("请输入试写主题");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await resolveAuthorIpStyle(ipId, { topic: t, contentType: "article" });
      setResolved(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
      setResolved(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-2 rounded-xl border border-line/70 bg-surface/60 px-3 py-2">
      <p className="text-xs font-medium text-muted">写作场景预览</p>
      <p className="mt-0.5 text-[10px] text-muted">输入主题，查看将命中的场景与启用的特色（不扣费）。</p>
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-dawn-md border border-line bg-canvas px-2 py-1.5 text-xs"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="试写主题"
          disabled={disabled || busy}
        />
        <Button type="button" variant="secondary" className="shrink-0 px-2.5 py-1.5 text-xs" disabled={disabled || busy} onClick={() => void onResolve()}>
          {busy ? "解析中…" : "解析"}
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-danger-ink">{error}</p> : null}
      {resolved ? (
        <div className="mt-2 space-y-1 text-xs text-ink">
          <p>
            <span className="text-muted">场景：</span>
            {resolved.sceneName}
            <span className="ml-2 text-muted">({resolved.contentTypeLabel})</span>
          </p>
          <p className="text-muted">{resolved.resolverLine}</p>
          {resolved.traitLabels?.length ? (
            <p className="line-clamp-2">
              <span className="text-muted">特色：</span>
              {resolved.traitLabels.join("、")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
