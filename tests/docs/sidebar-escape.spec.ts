import { expect, test } from "@playwright/test";

test("mobile sidebar closes with Escape and restores its trigger", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/docs/guides/quickstart");
      const trigger = page.locator("#nd-subnav").getByRole("button", {
        name: "Open Sidebar",
        exact: true,
      });
      await trigger.focus();
      await trigger.press("Enter");
      const sidebar = page.locator("#nd-sidebar-mobile");
      await expect(sidebar).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-expanded", "false", { timeout: 2000 });
      await expect(trigger).toBeFocused();
      await trigger.press("Enter");
      await sidebar.getByRole("link").first().focus();
      await page.keyboard.press("Escape");
      await expect(sidebar).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`closed-${width}-${scheme}.png`) });
    }
  }
});
