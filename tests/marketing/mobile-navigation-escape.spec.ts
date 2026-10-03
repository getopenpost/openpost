import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("mobile navigation closes with Escape and restores its trigger", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/tools");
  await dismissTelemetryConsent(page);
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false", { timeout: 2000 });
  await expect(trigger).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ["light", "dark"]) {
      await trigger.click();
      const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
      const theme = navigation.getByRole("button", { name: `Use ${scheme} theme`, exact: true });
      if (await theme.isVisible()) await theme.click();
      await navigation.getByRole("link", { name: "Free tools", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(navigation).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`closed-${width}-${scheme}.png`) });
    }
  }
  await trigger.click();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
