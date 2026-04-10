import { test, expect } from "@playwright/test";

/**
 * 验证 Docker 全栈（或本机 dev）下编排器与依赖就绪；不经过浏览器 CORS。
 */
test.describe("编排器与依赖", () => {
  test("/health 就绪", async ({ request }) => {
    const base = (process.env.ORCHESTRATOR_URL || "http://127.0.0.1:8008").replace(/\/$/, "");
    const res = await request.get(`${base}/health`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as {
      ok?: boolean;
      postgres?: string;
      redis?: string;
      object_store?: string;
    };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.postgres).toBe("ok");
    expect(body.redis).toBe("ok");
    expect(body.object_store).toBe("ok");
  });

  test("/health 透传并回写 X-Request-ID", async ({ request }) => {
    const base = (process.env.ORCHESTRATOR_URL || "http://127.0.0.1:8008").replace(/\/$/, "");
    const rid = `e2e-health-${Date.now()}`;
    const res = await request.get(`${base}/health`, { headers: { "x-request-id": rid } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const echo = res.headers()["x-request-id"] || res.headers()["X-Request-ID"];
    expect(echo).toBe(rid);
  });
});
