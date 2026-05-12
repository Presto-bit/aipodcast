"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, userAccountRef } from "../../lib/auth";
import { listRssChannels, type RssChannel } from "../../lib/api";
import { RSS_PUBLIC_BASE_URL } from "../../lib/rssPublicBase";
import { RssChannelEditor } from "./RssChannelEditor";

export type RssPublishSettingsPanelProps = {
  /** 列表或节目信息变更后通知外层刷新（例如作品发布页的频道下拉） */
  onChannelsUpdated?: () => void;
  /** `embedded`：用于弹窗内，去掉外层卡片描边与阴影 */
  variant?: "page" | "embedded";
};

export function RssPublishSettingsPanel({ onChannelsUpdated, variant = "page" }: RssPublishSettingsPanelProps) {
  const { ready, authRequired, user } = useAuth();
  const [rssLoading, setRssLoading] = useState(false);
  const [rssError, setRssError] = useState("");
  const [channels, setChannels] = useState<RssChannel[]>([]);
  const [showNew, setShowNew] = useState(false);

  const loadChannels = useCallback(async () => {
    setRssLoading(true);
    setRssError("");
    try {
      const rows = await listRssChannels();
      setChannels(rows);
    } catch (e) {
      setRssError(String(e instanceof Error ? e.message : e));
    } finally {
      setRssLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authRequired || !userAccountRef(user) || String(user?.phone) === "local") return;
    void loadChannels();
  }, [authRequired, user, loadChannels]);

  const rssLoggedIn = authRequired && userAccountRef(user) && String(user?.phone) !== "local";

  function mergeSaved(row: RssChannel) {
    setChannels((prev) => {
      const id = String(row.id || "");
      const idx = prev.findIndex((c) => String(c.id) === id);
      if (idx < 0) return [row, ...prev];
      const next = [...prev];
      next[idx] = row;
      return next;
    });
    onChannelsUpdated?.();
  }

  if (!ready) {
    return <p className="py-8 text-center text-sm text-muted">正在加载…</p>;
  }

  const wrapClass =
    variant === "embedded"
      ? "rounded-xl border-0 bg-transparent p-0 shadow-none"
      : "rounded-2xl border border-line bg-surface p-5 shadow-soft";

  return (
    <section className={wrapClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-ink">RSS 发布设置（小宇宙接入）</h2>
          <div className="group relative inline-flex">
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-warning/40 bg-warning-soft text-[12px] leading-none text-warning-ink"
              aria-label="查看 RSS 使用说明"
            >
              💡
            </button>
            <div className="pointer-events-none absolute left-0 top-6 z-20 hidden w-[min(32rem,88vw)] rounded-lg border border-line bg-surface px-3 py-2 text-[11px] leading-5 text-muted shadow-soft group-hover:block group-focus-within:block">
              <p className="font-medium text-ink">RSS怎么用</p>
              <p className="mt-1">
                你可以把RSS理解成“节目更新清单”。你在本站发布一集后，清单里会新增这一集；小宇宙会定时读取这份清单并更新节目
              </p>
              <ol className="mt-1 list-decimal pl-4">
                <li>可创建多个 RSS 节目，分别填写信息并保存。</li>
                <li>复制下方「节目源地址」（{RSS_PUBLIC_BASE_URL} 域名）。</li>
                <li>进入小宇宙创作者后台，找到“通过 RSS 导入/绑定节目”，粘贴该链接。</li>
                <li>以后到「我的作品」点击“发布”，选择对应频道后会写入 RSS，等平台抓取后对外展示。</li>
                <li>抓取通常有延迟（几分钟到几小时）。若暂时没看到更新，可先等待再刷新小宇宙后台。</li>
              </ol>
            </div>
          </div>
        </div>
        {rssLoggedIn ? (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-ink hover:bg-brand/15 disabled:opacity-50"
            disabled={rssLoading || showNew}
            onClick={() => setShowNew(true)}
          >
            新增 RSS 节目
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        节目源对外使用 <span className="font-mono text-ink">{RSS_PUBLIC_BASE_URL}</span>
        ；保存后为每个节目生成独立 RSS 链接，可绑定不同平台节目。
      </p>
      {!rssLoggedIn ? (
        <p className="mt-4 text-sm text-muted">使用 RSS 发布需先登录账号。</p>
      ) : (
        <>
          {rssLoading && channels.length === 0 && !showNew ? (
            <p className="mt-4 text-xs text-muted">加载中…</p>
          ) : null}
          {rssError ? <p className="mt-4 text-xs text-danger-ink">{rssError}</p> : null}

          <div className="mt-4 space-y-4">
            {showNew ? (
              <RssChannelEditor
                channel={null}
                isNew
                disabledGlobal={rssLoading}
                onSaved={(row) => {
                  mergeSaved(row);
                  setShowNew(false);
                }}
                onCancelNew={() => setShowNew(false)}
              />
            ) : null}
            {channels.map((ch) => (
              <RssChannelEditor
                key={ch.id}
                channel={ch}
                isNew={false}
                disabledGlobal={rssLoading}
                onSaved={(row) => mergeSaved(row)}
              />
            ))}
          </div>

          {!rssLoading && channels.length === 0 && !showNew ? (
            <p className="mt-4 text-xs text-muted">暂无 RSS 节目，点击右上角「新增 RSS 节目」创建。</p>
          ) : null}
        </>
      )}
    </section>
  );
}
