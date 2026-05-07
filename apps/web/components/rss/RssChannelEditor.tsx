"use client";

import { useEffect, useState } from "react";
import { upsertRssChannel, type RssChannel } from "../../lib/api";
import { rssFeedUrlForSlug, RSS_PUBLIC_BASE_URL } from "../../lib/rssPublicBase";

export type RssChannelEditorProps = {
  channel: RssChannel | null;
  isNew: boolean;
  disabledGlobal: boolean;
  onSaved: (row: RssChannel) => void;
  onCancelNew?: () => void;
};

export function RssChannelEditor({ channel, isNew, disabledGlobal, onSaved, onCancelNew }: RssChannelEditorProps) {
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
