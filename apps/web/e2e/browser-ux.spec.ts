import { test, expect } from "@playwright/test";

function e2eLoginPassword(): string {
  const p = (process.env.E2E_SMOKE_LOGIN_PASSWORD || "").trim();
  return p.length >= 8 ? p : "E2eSmoke!ci900";
}

test.describe("侧栏余额入口与任务进度（全栈 + FYV_AUTH）", () => {
  test("登录后可见侧栏余额入口；进行中任务有进度条", async ({ page }) => {
    const web = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
    const orch = (process.env.ORCHESTRATOR_URL || "http://127.0.0.1:8008").replace(/\/$/, "");
    const token = (process.env.E2E_SMOKE_SECRET || "").trim();
    test.skip(!token, "未配置 E2E_SMOKE_SECRET 时跳过");

    const smokeRes = await page.request.post(`${orch}/api/v1/e2e/smoke-chain`, {
      headers: { "X-E2E-Token": token }
    });
    expect(smokeRes.ok(), await smokeRes.text()).toBeTruthy();
    const smoke = (await smokeRes.json()) as {
      ok?: boolean;
      user_phone?: string;
      fixture_running_job_id?: string;
    };
    expect(smoke.ok, JSON.stringify(smoke)).toBe(true);
    const phone = String(smoke.user_phone || "").trim();
    const jobId = String(smoke.fixture_running_job_id || "").trim();
    expect(phone.length).toBeGreaterThan(3);
    expect(jobId.length).toBeGreaterThan(10);

    const loginRes = await page.request.post(`${web}/api/auth/login`, {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ identifier: phone, password: e2eLoginPassword() })
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const loginBody = (await loginRes.json()) as { success?: boolean };
    expect(loginBody.success).toBe(true);

    await page.goto("/");
    await expect(page.locator('aside nav a[href="/subscription"]').first()).toBeVisible({ timeout: 20_000 });

    await page.goto(`/jobs/${jobId}`);
    const bar = page.getByTestId("job-detail-progressbar");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    const now = Number(await bar.getAttribute("aria-valuenow"));
    expect(Number.isFinite(now)).toBe(true);
    expect(now).toBe(42);
  });
});
