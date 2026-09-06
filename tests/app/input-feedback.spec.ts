import { expect, test } from "@playwright/test";

test("password errors appear at the field on keyboard submission and focus the first invalid field", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/reset-password#token=local-invalid-preview-token");
  const password = page.locator("#new-password");
  const confirmation = page.locator("#confirm-password");
  await expect(password).toBeVisible({ timeout: 30000 });
  await expect(password).toHaveAttribute("aria-invalid", "false");
  await password.fill("short");
  await password.press("Enter");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toBeFocused();
  await expect(page.locator("#new-password-feedback")).toContainText("12");
  await password.fill("a-long-local-test-password");
  await confirmation.fill("different-local-test-password");
  await confirmation.press("Enter");
  await expect(confirmation).toHaveAttribute("aria-invalid", "true");
  await expect(confirmation).toBeFocused();
  await expect(page.locator("#confirm-password-feedback")).toContainText("match");
  for (const width of [1280, 390, 320])
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.screenshot({
        path: testInfo.outputPath(`validation-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  expect(errors).toEqual([]);
});
