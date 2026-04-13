"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, userAccountRef } from "../../../lib/auth";
import { listRssChannels, upsertRssChannel, type RssChannel } from "../../../lib/api";
import { rssFeedUrlForSlug, RSS_PUBLIC_BASE_URL } from "../../../lib/rssPublicBase";

type RssEditorProps = {
  channel: RssChannel | null;
  isNew: boolean;
  disabledGlobal: boolean;
  onSaved: (row: RssChannel) => void;
  onCancelNew?: () => void;
};

function RssChannelEditor({ channel, isNew, disabledGlobal, onSaved, onCancelNew }: RssEditorProps) {
  const [title, setTitle] = useState(channel?.title ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const [author, setAuthor] = useState(channel?.author ?? "");
  const [language, setLanguage] = useState(channel?.language ?? "zh-cn");
  const [imageUrl, setImageUrl] = useState(channel?.image_url ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [copyHint, setCopyHint] = useState("");

  useEffect(() => {
    if (!channel) return;
    setTitle(channel.title ?? "");
    setDescription(channel.description ?? "");
    setAuthor(channel.author ?? "");
    setLanguage(channel.language ?? "zh-cn");
    setImageUrl(channel.image_url ?? "");
  }, [channel]);

  const feedSlug = channel?.feed_slug?.trim() ?? "";
  const feedUrl = feedSlug ? rssFeedUrlForSlug(feedSlug) : "";

  async function save() {
    if (!title.trim()) {
      setErr("节目名称不能为空");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const row = await upsertRssChannel({
        ...(channel?.id ? { id: channel.id } : {}),
        title: title.trim(),
        description: description.trim(),
        author: author.trim(),
        language: language.trim() || "zh-cn",
        image_url: imageUrl.trim()
      });
      onSaved(row);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  }

  async function copyFeedUrl() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopyHint("已复制");
    } catch {
      setCopyHint("复制失败，请手动复制");
    } finally {
      window.setTimeout(() => setCopyHint(""), 1500);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-fill/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">{isNew ? "新建 RSS 节目" : "RSS 节目"}</p>
        {isNew && onCancelNew ? (
          <button
            type="button"
            className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={onCancelNew}
          >
            取消
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="节目名称（必填）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="主播/作者"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="语言，例如 zh-cn"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          placeholder="节目封面 URL（可选）"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
        <textarea
          className="sm:col-span-2 rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
          rows={3}
          placeholder="节目简介（可选）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
          disabled={saving || disabledGlobal}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : isNew ? "创建并保存" : "保存"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-danger-ink">{err}</p> : null}

      {feedUrl ? (
        <div className="mt-3 rounded-lg border border-line bg-fill/50 px-3 py-2 text-xs text-muted">
          <p className="font-medium text-ink">节目源地址</p>
          <p className="mt-0.5 text-[11px] text-muted">
            对外域名：<span className="font-mono text-ink">{RSS_PUBLIC_BASE_URL}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="break-all font-mono text-[11px] text-ink">{feedUrl}</p>
            <button
              type="button"
              className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-fill"
              onClick={() => void copyFeedUrl()}
            >
              复制链接
            </button>
            {copyHint ? <span className="text-[11px] text-muted">{copyHint}</span> : null}
          </div>
          <p className="mt-1 text-[11px]">把上面这个链接粘贴到小宇宙等平台「通过 RSS 导入/绑定节目」处。</p>
          {channel?.id ? <p className="mt-1 text-[11px]">频道 ID：{channel.id}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-muted">保存后将生成基于 {RSS_PUBLIC_BASE_URL} 的节目源链接。</p>
      )}
    </div>
  );
}

export default function MeGeneralPage() {
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
  }

  if (!ready) {
    return <p className="py-12 text-center text-sm text-muted">正在加载…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
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
              <p className="mt-4 text-sm text-muted">尚未创建 RSS 节目，点击「新增 RSS 节目」开始配置。</p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
