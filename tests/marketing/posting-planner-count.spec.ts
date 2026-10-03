import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("posting planner explains invalid counts and recovers a usable schedule", async ({
  page,
}, testInfo) => {
  await page.goto("/tools/best-time-to-post-calculator");
  await dismissTelemetryConsent(page);
  const count = page.getByRole("spinbutton", { name: "Posts per week", exact: true });
  await count.fill("0");
  await count.press("Tab");
  await expect(page.getByRole("status")).toContainText("Choose a whole number from 1 to 14", {
    timeout: 2000,
  });
  await expect(count).toHaveAttribute("aria-invalid", "true");
  await expect(count).toHaveAccessibleDescription(/whole number from 1 to 14/);
  await expect(page.getByRole("button", { name: "Copy CSV", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
      const phone = await navigation.isVisible();
      if (phone) await navigation.click();
      const toggle = page.getByRole("button", { name: `Use ${theme} theme`, exact: true });
      if (await toggle.isVisible()) await toggle.click();
      if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
      const guidance = page.getByRole("status");
      await guidance.scrollIntoViewIfNeeded();
      await expect(guidance).toBeInViewport();
      await expect(guidance).toContainText("Choose a whole number from 1 to 14");
      await page.screenshot({
        path: testInfo.outputPath(`count-guidance-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  for (const value of ["", "2.5", "15"]) {
    await count.fill(value);
    await count.press("Tab");
    await expect(count).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  }
  await count.fill("3");
  await count.press("Tab");
  await expect(count).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("button", { name: "Copy CSV", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
  await expect(page.locator('[aria-labelledby="planner-output-title"] ol > li')).toHaveCount(3);
});
