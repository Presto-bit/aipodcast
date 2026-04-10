"use client";

import { useEffect, useState } from "react";
import { useAuth, userAccountRef } from "../../../lib/auth";
import { useI18n } from "../../../lib/I18nContext";
import { useTheme } from "../../../lib/ThemeContext";
import { listRssChannels, upsertRssChannel } from "../../../lib/api";

export default function MeGeneralPage() {
  const { t, lang, setLang } = useI18n();
  const { ready, authRequired, user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [prefsSavedHint, setPrefsSavedHint] = useState("");
  const [rssLoading, setRssLoading] = useState(false);
  const [rssSaving, setRssSaving] = useState(false);
  const [rssError, setRssError] = useState("");
  const [rssChannelId, setRssChannelId] = useState("");
  const [rssFeedSlug, setRssFeedSlug] = useState("");
  const [rssTitle, setRssTitle] = useState("");
  const [rssDescription, setRssDescription] = useState("");
  const [rssAuthor, setRssAuthor] = useState("");
  const [rssLanguage, setRssLanguage] = useState("zh-cn");
  const [rssImageUrl, setRssImageUrl] = useState("");
  const [rssCopyHint, setRssCopyHint] = useState("");

  useEffect(() => {
    if (!authRequired || !userAccountRef(user) || String(user?.phone) === "local") return;
    let canceled = false;
    async function run() {
      setRssLoading(true);
      setRssError("");
      try {
        const channels = await listRssChannels();
        if (canceled || channels.length === 0) return;
        const first = channels[0]!;
        setRssChannelId(String(first.id || ""));
        setRssFeedSlug(String(first.feed_slug || ""));
        setRssTitle(String(first.title || ""));
        setRssDescription(String(first.description || ""));
        setRssAuthor(String(first.author || ""));
        setRssLanguage(String(first.language || "zh-cn"));
        setRssImageUrl(String(first.image_url || ""));
      } catch (e) {
        if (canceled) return;
        setRssError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!canceled) setRssLoading(false);
      }
    }
    void run();
    return () => {
      canceled = true;
    };
  }, [authRequired, user]);

  async function saveRssSettings() {
    if (!rssTitle.trim()) {
      setRssError("节目名称不能为空");
      return;
    }
    setRssSaving(true);
    setRssError("");
    try {
      const row = await upsertRssChannel({
        title: rssTitle.trim(),
        description: rssDescription.trim(),
        author: rssAuthor.trim(),
        language: rssLanguage.trim() || "zh-cn",
        image_url: rssImageUrl.trim()
      });
      setRssChannelId(String(row.id || ""));
      setRssFeedSlug(String(row.feed_slug || ""));
      setPrefsSavedHint("RSS 已保存");
      window.setTimeout(() => setPrefsSavedHint(""), 1200);
    } catch (e) {
      setRssError(String(e instanceof Error ? e.message : e));
    } finally {
      setRssSaving(false);
    }
  }

  async function copyRssFeedUrl() {
    const url = rssFeedSlug
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/rss/feed/${rssFeedSlug}`
      : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setRssCopyHint("已复制");
    } catch {
      setRssCopyHint("复制失败，请手动复制");
    } finally {
      window.setTimeout(() => setRssCopyHint(""), 1500);
    }
  }

  if (!ready) {
    return <p className="py-12 text-center text-sm text-muted">正在加载…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
        <h2 className="text-sm font-semibold text-ink">{t("settings.account")}</h2>
        <p className="mt-1 text-xs text-muted">主题与界面语言。</p>
        {prefsSavedHint ? <p className="mt-2 text-xs text-muted">{prefsSavedHint}</p> : null}

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-ink">{t("settings.theme")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${theme === "light" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                onClick={() => setTheme("light")}
              >
                {t("theme.light")}
              </button>
              <button
                type="button"
                className={`rounded-lg px-3 py-1.5 text-sm ${theme === "dark" ? "bg-brand text-brand-foreground" : "border border-line"}`}
                onClick={() => setTheme("dark")}
              >
                {t("theme.dark")}
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-ink">{t("settings.language")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${lang === "zh" ? "border-brand bg-fill" : "border-line"}`}
                onClick={() => setLang("zh")}
              >
                {t("lang.zh")}
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${lang === "en" ? "border-brand bg-fill" : "border-line"}`}
                onClick={() => setLang("en")}
              >
                {t("lang.en")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
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
                <li>先在这里填写节目名称等信息并点击「保存 RSS 设置」。</li>
                <li>复制下方“节目源地址”（就是 RSS 链接）。</li>
                <li>进入小宇宙创作者后台，找到“通过 RSS 导入/绑定节目”，粘贴该链接。</li>
                <li>以后到「我的作品」点击“发布”，就会自动写入 RSS，等小宇宙抓取后对外展示。</li>
                <li>抓取通常有延迟（几分钟到几小时）。如果暂时没看到更新，先等等再刷新小宇宙后台。</li>
              </ol>
            </div>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted">
          首次配置后会生成节目源地址，把它提交到小宇宙创作者后台即可。后续在“我的作品”中可直接发布新集。
        </p>
        {!authRequired || !userAccountRef(user) || String(user?.phone) === "local" ? (
          <p className="mt-4 text-sm text-muted">使用 RSS 发布需先登录账号。</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                placeholder="节目名称（必填）"
                value={rssTitle}
                onChange={(e) => setRssTitle(e.target.value)}
              />
              <input
                className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                placeholder="主播/作者"
                value={rssAuthor}
                onChange={(e) => setRssAuthor(e.target.value)}
              />
              <input
                className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                placeholder="语言，例如 zh-cn"
                value={rssLanguage}
                onChange={(e) => setRssLanguage(e.target.value)}
              />
              <input
                className="rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                placeholder="节目封面 URL（可选）"
                value={rssImageUrl}
                onChange={(e) => setRssImageUrl(e.target.value)}
              />
              <textarea
                className="sm:col-span-2 rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink"
                rows={3}
                placeholder="节目简介（可选）"
                value={rssDescription}
                onChange={(e) => setRssDescription(e.target.value)}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-95 disabled:opacity-50"
                disabled={rssSaving || rssLoading}
                onClick={() => void saveRssSettings()}
              >
                {rssSaving ? "保存中…" : "保存 RSS 设置"}
              </button>
              {rssLoading ? <span className="text-xs text-muted">加载中…</span> : null}
            </div>
            {rssError ? <p className="mt-2 text-xs text-danger-ink">{rssError}</p> : null}
            {rssFeedSlug ? (
              <div className="mt-2 rounded-lg border border-line bg-fill/50 px-3 py-2 text-xs text-muted">
                <p className="font-medium text-ink">节目源地址</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="break-all font-mono text-[11px] text-ink">
                    {typeof window !== "undefined" ? `${window.location.origin}/api/rss/feed/${rssFeedSlug}` : `/api/rss/feed/${rssFeedSlug}`}
                  </p>
                  <button
                    type="button"
                    className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-fill"
                    onClick={() => void copyRssFeedUrl()}
                  >
                    复制链接
                  </button>
                  {rssCopyHint ? <span className="text-[11px] text-muted">{rssCopyHint}</span> : null}
                </div>
                <p className="mt-1 text-[11px]">把上面这个链接粘贴到小宇宙创作者后台的 RSS 导入位置。</p>
                {rssChannelId ? <p className="mt-1 text-[11px]">频道 ID：{rssChannelId}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
