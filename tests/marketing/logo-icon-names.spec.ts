import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("logo icon variants have distinct names and keyboard selection", async ({
  page,
}, testInfo) => {
  await page.goto("/tools/logo-maker");
  await dismissTelemetryConsent(page);
  await page.getByRole("textbox", { name: "Search icons", exact: true }).fill("flower");
  const collection = page.locator('[aria-label="Icon collection"]');
  const original = collection.getByRole("button", { name: "Flower", exact: true });
  const variant = collection.getByRole("button", { name: "Flower 2", exact: true });
  await expect(variant).toBeVisible({ timeout: 2000 });
  await expect(original).toHaveCount(1);
  await expect(variant).toHaveAttribute("title", "Flower 2");
  await variant.focus();
  await variant.press("Enter");
  await expect(variant).toHaveAttribute("aria-pressed", "true");
  await expect(original).toHaveAttribute("aria-pressed", "false");
  await original.focus();
  await original.press("Enter");
  await expect(original).toHaveAttribute("aria-pressed", "true");
  await expect(variant).toHaveAttribute("aria-pressed", "false");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scheme of ["light", "dark"]) {
      const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
      const phone = await navigation.isVisible();
      if (phone) await navigation.click();
      const theme = page.getByRole("button", { name: `Use ${scheme} theme`, exact: true });
      if (await theme.isVisible()) await theme.click();
      if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
      await variant.scrollIntoViewIfNeeded();
      await variant.focus();
      await expect(variant).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`variants-${width}-${scheme}.png`) });
    }
  }
});
