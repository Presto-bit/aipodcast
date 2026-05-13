import { test, expect } from "@playwright/test";

test.describe("首页", () => {
  test("展示主标题与播客入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "基于可信资料的多形态创作助手" })).toBeVisible();
    await expect(page.getByRole("link", { name: "开始生成播客" })).toBeVisible();
  });
});
