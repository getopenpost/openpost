import { expect, test } from "@playwright/test";
test("verification without a challenge explains recovery once", async ({ page }, info) => {
  await page.goto("/verify-email");
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.reload();
      const message = page.getByText(
        "This code is invalid or expired. Check your inbox for the latest code, confirm your email address, and try again or request another code. If it still does not work, sign in again or contact your workspace owner.",
        { exact: true },
      );
      await page.screenshot({ path: info.outputPath(`verify-${width}-${scheme}.png`) });
      await expect(message).toHaveCount(1);
      await expect(message).toBeVisible();
      const recovery = page.getByRole("link", { name: "Back to sign in", exact: true });
      await recovery.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/verify-email");
    }
});
