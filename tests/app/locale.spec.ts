import { expect, test } from "@playwright/test";

test.describe("Arabic", () => {
  test.use({ locale: "ar-SA" });

  test("a fresh Arabic browser lays the app out right to left", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/login");
    const heading = page.getByRole("heading", { name: "تسجيل الدخول", exact: true });
    await expect(heading).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const field = page.getByRole("textbox", { name: "البريد الإلكتروني" });
    await expect(heading).toHaveCSS("direction", "rtl");
    // Email addresses read left to right even inside an Arabic page.
    await expect(field).toHaveCSS("direction", "ltr");
    const box = await field.boundingBox();
    const label = await page.getByText("البريد الإلكتروني", { exact: true }).first().boundingBox();
    // The label starts at the field's right edge, the inline start in Arabic.
    expect(Math.abs(label!.x + label!.width - (box!.x + box!.width))).toBeLessThan(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280,
    );
  });
});
