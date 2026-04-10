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
