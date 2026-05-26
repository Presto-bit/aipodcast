"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthorIpContentTypeChips, { CHAR_PRESETS } from "../../../../../../components/notes/AuthorIpContentTypeChips";
import UserErrorBanner from "../../../../../../components/ui/UserErrorBanner";
import {
  type AuthorIpComposeResult,
  type AuthorIpItem,
  type AuthorIpResolver,
  ackAuthorIpFirstCompare,
  composeAuthorIpArticle,
  composeAuthorIpArticleStream,
  fetchAuthorIps,
  fetchComposeBillingPreview,
  learnAuthorIp,
  needsAuthorIpColdStart,
  profileFirstCompareShown,
  resolveAuthorIpStyle,
  saveAuthorIpCompose,
  submitAuthorIpColdStart,
  submitAuthorIpStyleFeedback
} from "../../../../../../lib/authorIp";

export default function AuthorIpWritePage() {
  const params = useParams();
  const router = useRouter();
  const ipId = String(params?.ipId || "");
  const [allIps, setAllIps] = useState<AuthorIpItem[]>([]);
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState("");
  const [contentType, setContentType] = useState("article");
  const [targetChars, setTargetChars] = useState(1500);
  const [experienceLevel, setExperienceLevel] = useState("default");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [useAuthorStyle, setUseAuthorStyle] = useState(true);
  const [whoAmI, setWhoAmI] = useState("");
  const [audience, setAudience] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [coldStartOpen, setColdStartOpen] = useState(false);
  const [resolver, setResolver] = useState<AuthorIpResolver | null>(null);
  const [result, setResult] = useState<AuthorIpComposeResult | null>(null);
  const [genericBody, setGenericBody] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [streamingBody, setStreamingBody] = useState("");
  const [billingHint, setBillingHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [coldBusy, setColdBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [compareBusy, setCompareBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<"like" | "dislike" | null>(null);

  const showColdStart = useMemo(() => needsAuthorIpColdStart(item), [item]);
  const showCompareOffer = useMemo(
    () => Boolean(result?.body) && !profileFirstCompareShown(item),
    [item, result?.body]
  );

  const load = useCallback(async () => {
    if (!ipId) return;
    try {
      const list = await fetchAuthorIps();
      setAllIps(list);
      const found = list.find((x) => x.id === ipId) ?? null;
      setItem(found);
      setColdStartOpen(needsAuthorIpColdStart(found));
      if (found?.oneLiner) setOneLiner((prev) => prev || found.oneLiner);
      if (found?.isTemplate) {
        const demo = (found.profile as { composeDemo?: { topic?: string } })?.composeDemo;
        if (demo?.topic) setTopic((prev) => prev || demo.topic || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ipId || !topic.trim()) {
      setBillingHint(null);
      return;
    }
    const t = window.setTimeout(() => {
      void fetchComposeBillingPreview(ipId, { targetChars, contentType })
        .then((p) => {
          if (!p.canAfford && p.message) setBillingHint(p.message);
          else setBillingHint(null);
        })
        .catch(() => setBillingHint(null));
    }, 400);
    return () => window.clearTimeout(t);
  }, [ipId, targetChars, contentType, topic]);

  const topicTrimmed = topic.trim();

  const runColdStart = async () => {
    if (!oneLiner.trim()) {
      setError("请填写一句话定位");
      return;
    }
    setColdBusy(true);
    setError(null);
    try {
      const updated = await submitAuthorIpColdStart(ipId, {
        whoAmI: whoAmI.trim(),
        audience: audience.trim(),
        oneLiner: oneLiner.trim()
      });
      setItem(updated);
      setColdStartOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setColdBusy(false);
    }
  };

  const runResolve = useCallback(async () => {
    if (!ipId || !topicTrimmed) return;
    setResolving(true);
    setError(null);
    try {
      const r = await resolveAuthorIpStyle(ipId, {
        topic: topicTrimmed,
        outline,
        contentType,
        experienceLevel
      });
      setResolver(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setResolving(false);
    }
  }, [ipId, topicTrimmed, outline, contentType, experienceLevel]);

  const runCompose = useCallback(async () => {
    if (!ipId || !topicTrimmed) {
      setError("请填写主题");
      return;
    }
    setLoading(true);
    setError(null);
    setFeedbackSent(null);
    setSavedNote(false);
    setResult(null);
    setGenericBody("");
    setCompareOpen(false);
    setStreamingBody("");
    try {
      const out = await composeAuthorIpArticleStream(
        ipId,
        { topic: topicTrimmed, outline, useAuthorStyle, contentType, targetChars, experienceLevel },
        (ev) => {
          if (ev.type === "resolver" && ev.resolver) {
            setResolver(ev.resolver as AuthorIpResolver);
          }
          if (ev.type === "chunk" && typeof ev.text === "string") {
            setStreamingBody((prev) => prev + ev.text);
          }
        }
      );
      setResult(out);
      setResolver(out.resolver);
      setStreamingBody("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "生成失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [ipId, topicTrimmed, outline, useAuthorStyle, contentType, targetChars, experienceLevel]);

  const runGenericCompare = async () => {
    if (!topicTrimmed) return;
    setCompareBusy(true);
    setError(null);
    try {
      const out = await composeAuthorIpArticle(ipId, {
        topic: topicTrimmed,
        outline,
        useAuthorStyle: false,
        contentType,
        targetChars: Math.min(targetChars, 800)
      });
      setGenericBody(out.body);
      setCompareOpen(true);
      await ackAuthorIpFirstCompare(ipId);
      setItem((prev) =>
        prev
          ? {
              ...prev,
              profile: {
                ...prev.profile,
                flags: { ...((prev.profile as { flags?: object }).flags || {}), firstCompareShown: true }
              }
            }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "对照生成失败");
    } finally {
      setCompareBusy(false);
    }
  };

  const saveToIp = async () => {
    const body = result?.body?.trim();
    if (!body) return;
    setSaveBusy(true);
    setError(null);
    try {
      await saveAuthorIpCompose(ipId, {
        draftBody: body,
        topic: topicTrimmed,
        title: topicTrimmed.slice(0, 80) || "成稿"
      });
      setSavedNote(true);
      await learnAuthorIp(ipId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaveBusy(false);
    }
  };

  const sendFeedback = async (liked: boolean) => {
    try {
      await submitAuthorIpStyleFeedback(ipId, liked);
      setFeedbackSent(liked ? "like" : "dislike");
    } catch (e) {
      setError(e instanceof Error ? e.message : "反馈失败");
    }
  };

  const charPresets = CHAR_PRESETS[contentType] || CHAR_PRESETS.article;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">写一篇</h1>
          <p className="mt-1 text-sm text-muted">{item?.displayName ?? "…"}</p>
        </div>
        {allIps.length > 1 ? (
          <label className="text-xs text-muted">
            切换 IP
            <select
              className="ml-2 rounded border border-line bg-canvas px-2 py-1 text-sm text-ink"
              value={ipId}
              onChange={(e) => router.push(`/notes/author-ip/${e.target.value}/write`)}
            >
              {allIps.map((ip) => (
                <option key={ip.id} value={ip.id}>
                  {ip.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {billingHint ? (
        <p className="mt-3 text-xs text-danger-ink">
          {billingHint}{" "}
          <Link href="/subscription#wallet-topup" className="text-brand underline">
            去充值
          </Link>
        </p>
      ) : null}

      {error ? <UserErrorBanner className="mt-4" message={error} /> : null}

      {showColdStart && coldStartOpen ? (
        <section className="mt-6 rounded-2xl border border-brand/35 bg-brand/5 p-5">
          <h2 className="text-sm font-semibold text-ink">约 30 秒 · 完善你的 IP</h2>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-ink">我是谁</label>
              <textarea
                className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
                rows={2}
                value={whoAmI}
                onChange={(e) => setWhoAmI(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink">写给谁</label>
              <textarea
                className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
                rows={2}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink">一句话定位 *</label>
              <input
                className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
                value={oneLiner}
                onChange={(e) => setOneLiner(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
              disabled={coldBusy}
              onClick={() => void runColdStart()}
            >
              {coldBusy ? "保存中…" : "保存并继续"}
            </button>
            <button
              type="button"
              className="rounded-dawn-md border border-line px-4 py-2 text-sm text-muted"
              onClick={() => setColdStartOpen(false)}
            >
              稍后再说
            </button>
          </div>
        </section>
      ) : null}

      <div className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="rounded"
            checked={useAuthorStyle}
            onChange={(e) => setUseAuthorStyle(e.target.checked)}
          />
          按我的风格写作
        </label>
        {resolver?.resolverLine ? (
          <p className="text-xs text-muted">{resolver.resolverLine}</p>
        ) : null}
        <div>
          <label className="text-sm font-medium text-ink">主题 *</label>
          <textarea
            className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-ink">大纲（可选）</label>
          <textarea
            className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            rows={2}
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
          />
        </div>
        <div>
          <span className="text-sm font-medium text-ink">体裁</span>
          <AuthorIpContentTypeChips
            className="mt-2"
            value={contentType}
            onChange={(id, def) => {
              setContentType(id);
              setTargetChars(def);
            }}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-ink">目标字数</label>
          <select
            className="mt-1 rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
            value={targetChars}
            onChange={(e) => setTargetChars(Number(e.target.value))}
          >
            {charPresets.map((n) => (
              <option key={n} value={n}>
                约 {n} 字
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="text-xs text-brand hover:underline"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "收起高级" : "高级选项"}
        </button>
        {advancedOpen ? (
          <label className="block text-sm text-ink">
            引用经历
            <select
              className="mt-1 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
              value={experienceLevel}
              onChange={(e) => setExperienceLevel(e.target.value)}
            >
              <option value="less">少</option>
              <option value="default">默认</option>
              <option value="more">多</option>
            </select>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-dawn-md border border-line px-4 py-2 text-sm disabled:opacity-50"
            disabled={!topicTrimmed || resolving}
            onClick={() => void runResolve()}
          >
            {resolving ? "解析中…" : "预览风格解析"}
          </button>
          <button
            type="button"
            className="rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
            disabled={!topicTrimmed || loading}
            onClick={() => void runCompose()}
          >
            {loading ? "生成中…" : "生成文章"}
          </button>
        </div>
      </div>

      {loading && streamingBody ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">生成中…</h2>
          <div className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-fill/40 p-4 text-sm">
            {streamingBody}
          </div>
        </section>
      ) : null}

      {result?.body ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">成稿（我的风格）</h2>
          <div className="mt-2 whitespace-pre-wrap rounded-xl border border-line bg-fill/40 p-4 text-sm text-ink">
            {result.body}
          </div>
          {result.imprint ? (
            <div className="mt-4 rounded-xl border border-dashed border-line p-4">
              <h3 className="text-sm font-semibold text-ink">个人印记</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                <li>场景：{result.imprint.sceneName}</li>
                {result.imprint.citedExperiences?.length ? (
                  <li>引用：{result.imprint.citedExperiences.join("；")}</li>
                ) : null}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-dawn-md border border-line px-3 py-1 text-xs disabled:opacity-50"
                  disabled={feedbackSent !== null}
                  onClick={() => void sendFeedback(true)}
                >
                  像我的风格
                </button>
                <button
                  type="button"
                  className="rounded-dawn-md border border-line px-3 py-1 text-xs disabled:opacity-50"
                  disabled={feedbackSent !== null}
                  onClick={() => void sendFeedback(false)}
                >
                  不太像
                </button>
                {!item?.isReadOnly ? (
                  <>
                    <button
                      type="button"
                      className="rounded-dawn-md bg-brand/90 px-3 py-1 text-xs font-medium text-brand-foreground disabled:opacity-50"
                      disabled={saveBusy || savedNote}
                      onClick={() => void saveToIp()}
                    >
                      {savedNote ? "已保存" : saveBusy ? "保存中…" : "保存到 IP 素材"}
                    </button>
                    <button
                      type="button"
                      className="rounded-dawn-md border border-line px-3 py-1 text-xs disabled:opacity-50"
                      disabled={saveBusy}
                      onClick={() => {
                        setSaveBusy(true);
                        void learnAuthorIp(ipId)
                          .then(() => load())
                          .catch((e) => setError(e instanceof Error ? e.message : "失败"))
                          .finally(() => setSaveBusy(false));
                      }}
                    >
                      用此篇再学习
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {showCompareOffer ? (
            <div className="mt-4">
              <button
                type="button"
                className="text-sm text-brand hover:underline disabled:opacity-50"
                disabled={compareBusy}
                onClick={() => void runGenericCompare()}
              >
                {compareBusy ? "生成对照中…" : "查看通用写法对照（首次）"}
              </button>
            </div>
          ) : null}
          {compareOpen && genericBody ? (
            <details className="mt-4 rounded-xl border border-line bg-fill/20 p-4" open>
              <summary className="cursor-pointer text-sm font-medium text-ink">通用写法对照</summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{genericBody}</p>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
