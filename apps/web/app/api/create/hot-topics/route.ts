import { NextRequest, NextResponse } from "next/server";
import { allowCreateHotTopicsPerIp, clientIpFromNextRequest } from "../../../../lib/authRouteRateLimit";
import { buildHotTopicPodcastDraft, truncateTopicLabel, type HotTopicSourceId } from "../../../../lib/createHotTopicDraft";

const UPSTREAM_TIMEOUT_MS = 10_000;
const VISIBLE_COUNT = 6;

type RawHeadline = { title: string; source: HotTopicSourceId };

function upstreamSignal(): AbortSignal {
  return AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
}

function normalizeDedupeKey(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

function collectBaiduWords(node: unknown, acc: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) collectBaiduWords(x, acc);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o.word === "string") {
    const w = o.word.trim();
    if (w.length >= 4) acc.push(w);
  }
  for (const v of Object.values(o)) collectBaiduWords(v, acc);
}

/**
 * 百度实时热搜：与网页 https://top.baidu.com/board?tab=realtime 同一「实时榜」；
 * 使用官方 board JSON（tab=realtime；platform=wise 为榜单接口常用参数，条目与 PC 榜一致）。
 */
async function fetchBaiduHotWords(signal: AbortSignal): Promise<string[]> {
  const res = await fetch("https://top.baidu.com/api/board?platform=wise&tab=realtime", {
    signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; PrestoHotTopics/1.0)"
    },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`baidu ${res.status}`);
  const j = (await res.json()) as { data?: unknown };
  const acc: string[] = [];
  collectBaiduWords(j?.data, acc);
  return [...new Set(acc)].slice(0, 35);
}

async function fetchTencentHotTitles(signal: AbortSignal): Promise<string[]> {
  const res = await fetch(
    "https://i.news.qq.com/gw/event/pc_hot_ranking_list?ids_hash=&offset=0&page_size=45",
    {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PrestoHotTopics/1.0)"
      },
      cache: "no-store"
    }
  );
  if (!res.ok) throw new Error(`tencent ${res.status}`);
  const j = (await res.json()) as {
    idlist?: Array<{ newslist?: Array<{ title?: string }> }>;
  };
  const list = j?.idlist?.[0]?.newslist;
  if (!Array.isArray(list)) throw new Error("tencent shape");
  const out: string[] = [];
  for (const row of list) {
    const t = String(row?.title || "").trim();
    if (t.length < 6) continue;
    if (t.includes("腾讯新闻用户最关注") || t.includes("每10分钟更新")) continue;
    out.push(t);
  }
  return [...new Set(out)].slice(0, 35);
}

async function fetchSinaRollTitles(signal: AbortSignal): Promise<string[]> {
  const res = await fetch(
    "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2511&num=35&page=1",
    {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PrestoHotTopics/1.0)"
      },
      cache: "no-store"
    }
  );
  if (!res.ok) throw new Error(`sina ${res.status}`);
  const j = (await res.json()) as { result?: { data?: Array<{ title?: string }> } };
  const rows = j?.result?.data;
  if (!Array.isArray(rows)) throw new Error("sina shape");
  const out: string[] = [];
  for (const row of rows) {
    const t = String(row?.title || "").trim();
    if (t.length >= 6) out.push(t);
  }
  return [...new Set(out)].slice(0, 35);
}

/** 轮询多源 headline，去重后保持来源多样性 */
function mergeHeadlinesRoundRobin(
  baidu: string[],
  tencent: string[],
  sina: string[]
): RawHeadline[] {
  const seen = new Set<string>();
  const merged: RawHeadline[] = [];
  const maxLen = Math.max(baidu.length, tencent.length, sina.length);
  for (let i = 0; i < maxLen; i++) {
    const batch: RawHeadline[] = [];
    if (i < baidu.length) batch.push({ title: baidu[i]!, source: "baidu" });
    if (i < tencent.length) batch.push({ title: tencent[i]!, source: "tencent" });
    if (i < sina.length) batch.push({ title: sina[i]!, source: "sina" });
    for (const h of batch) {
      const k = normalizeDedupeKey(h.title);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(h);
    }
  }
  return merged;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

/**
 * GET /api/create/hot-topics?seed=123
 * 聚合多源热点标题，生成播客选题提示（最多 6 条）。
 */
export async function GET(req: NextRequest) {
  if (!allowCreateHotTopicsPerIp(clientIpFromNextRequest(req))) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429 });
  }

  const seedRaw = req.nextUrl.searchParams.get("seed");
  const seed = Math.floor(Number(seedRaw)) || (Date.now() % 2147483646) + 1;

  let baidu: string[] = [];
  let tencent: string[] = [];
  let sina: string[] = [];

  const [r1, r2, r3] = await Promise.allSettled([
    fetchBaiduHotWords(upstreamSignal()),
    fetchTencentHotTitles(upstreamSignal()),
    fetchSinaRollTitles(upstreamSignal())
  ]);

  if (r1.status === "fulfilled") baidu = r1.value;
  if (r2.status === "fulfilled") tencent = r2.value;
  if (r3.status === "fulfilled") sina = r3.value;

  const merged = mergeHeadlinesRoundRobin(baidu, tencent, sina);
  const rnd = mulberry32(seed);

  if (merged.length === 0) {
    return NextResponse.json(
      { success: true, topics: [], seed },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  shuffleInPlace(merged, rnd);
  const picked = merged.slice(0, VISIBLE_COUNT);

  const topics = picked.map((h) => ({
    label: truncateTopicLabel(h.title),
    text: buildHotTopicPodcastDraft(h.title)
  }));

  return NextResponse.json(
    { success: true, topics, seed },
    { headers: { "Cache-Control": "no-store" } }
  );
}
