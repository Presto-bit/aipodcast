import crypto from "crypto";
import { test, expect } from "@playwright/test";

function internalSignedHeadersForGet(): Record<string, string> {
  const secret = process.env.INTERNAL_SIGNING_SECRET || "local-internal-secret";
  const payload = "{}";
  const timestamp = String(Date.now());
  const payloadSha256 = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}:${payloadSha256}`, "utf8")
    .digest("hex");
  return {
    "x-internal-timestamp": timestamp,
    "x-internal-payload-sha256": payloadSha256,
    "x-internal-signature": signature
  };
}

test.describe("冒烟链（播客源 fixture → RSS）", () => {
  test("编排器 e2e 接口串起全流程", async ({ request }) => {
    const base = (process.env.ORCHESTRATOR_URL || "http://127.0.0.1:8008").replace(/\/$/, "");
    const token = (process.env.E2E_SMOKE_SECRET || "").trim();
    test.skip(!token, "未配置 E2E_SMOKE_SECRET 时跳过（与 docker-compose.e2e 默认值对齐）");

    const res = await request.post(`${base}/api/v1/e2e/smoke-chain`, {
      headers: { "X-E2E-Token": token }
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as {
      ok?: boolean;
      feed_slug?: string;
      source_job_id?: string;
    };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.feed_slug, JSON.stringify(body)).toBeTruthy();
    expect(body.source_job_id).toBeTruthy();

    const slug = String(body.feed_slug);
    const feedRes = await request.get(`${base}/api/v1/rss/feed/${encodeURIComponent(slug)}`, {
      headers: {
        ...internalSignedHeadersForGet(),
        "x-public-base-url": "http://127.0.0.1:3000"
      }
    });
    expect(feedRes.ok(), await feedRes.text()).toBeTruthy();
    const xml = await feedRes.text();
    expect(xml).toContain("<rss");
    expect(xml).toContain("E2E Published");
  });
});
