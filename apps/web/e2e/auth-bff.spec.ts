import { test, expect } from "@playwright/test";

/**
 * Next BFF 鉴权相关路径（依赖 PLAYWRIGHT_BASE_URL 可访问；CI 全栈已起 web）。
 */
test.describe("BFF 注册发码", () => {
  test("拒绝无效负载并返回 x-request-id", async ({ request }) => {
    const web = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
    const customRid = `e2e-reg-${Date.now()}`;
    const res = await request.post(`${web}/api/auth/register/send-code`, {
      headers: {
        "content-type": "application/json",
        "x-request-id": customRid
      },
      data: JSON.stringify({ email: "not-an-email", username: "usr" })
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const echo = res.headers()["x-request-id"] || res.headers()["X-Request-ID"];
    expect(echo).toBe(customRid);
  });
});

test.describe("Auth 并发登录策略", () => {
  test("配置返回允许多端同时在线", async ({ request }) => {
    const web = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
    const res = await request.get(`${web}/api/auth/config`);
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()) as { success?: boolean; concurrent_login_policy?: string };
    expect(data.success).toBeTruthy();
    expect(data.concurrent_login_policy).toBe("allow_multi");
  });

  test("同账号双会话可并发保持在线（可选凭据）", async ({ playwright }) => {
    const identifier = (process.env.E2E_AUTH_IDENTIFIER || "").trim();
    const password = String(process.env.E2E_AUTH_PASSWORD || "");
    test.skip(!identifier || !password, "缺少 E2E_AUTH_IDENTIFIER / E2E_AUTH_PASSWORD，跳过该用例");
    const web = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

    const ctxA = await playwright.request.newContext();
    const ctxB = await playwright.request.newContext();
    try {
      const loginA = await ctxA.post(`${web}/api/auth/login`, {
        headers: { "content-type": "application/json" },
        data: { identifier, password }
      });
      expect(loginA.ok()).toBeTruthy();

      const loginB = await ctxB.post(`${web}/api/auth/login`, {
        headers: { "content-type": "application/json" },
        data: { identifier, password }
      });
      expect(loginB.ok()).toBeTruthy();

      const [meA, meB] = await Promise.all([ctxA.get(`${web}/api/auth/me`), ctxB.get(`${web}/api/auth/me`)]);
      expect(meA.status()).toBe(200);
      expect(meB.status()).toBe(200);

      const payloadA = (await meA.json()) as { success?: boolean; user?: { user_id?: string } };
      const payloadB = (await meB.json()) as { success?: boolean; user?: { user_id?: string } };
      expect(payloadA.success).toBeTruthy();
      expect(payloadB.success).toBeTruthy();
      expect(String(payloadA.user?.user_id || "").trim()).not.toBe("");
      expect(String(payloadA.user?.user_id || "").trim()).toBe(String(payloadB.user?.user_id || "").trim());
    } finally {
      await ctxA.dispose();
      await ctxB.dispose();
    }
  });
});
