import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("extensions are discoverable and their install pages fit a phone @desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tools");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  const extensions = page.locator("#extensions");
  await expect(extensions.getByRole("link", { name: /YouTube Localizer/ })).toBeVisible();
  await expect(extensions.getByRole("link", { name: /X Timeline Blocker/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search free tools" }).fill("YouTube");
  await expect(extensions.getByRole("link")).toHaveCount(1);
  await extensions.getByRole("link", { name: /YouTube Localizer/ }).click();
  await expect(page.getByRole("heading", { name: "YouTube Localizer", exact: true })).toBeVisible();
  for (const route of ["/tools/youtube-localizer", "/tools/x-timeline-blocker"]) {
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("figure img")).toBeVisible();
    expect(
      await page
        .locator("figure img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await expect(
      page.getByRole("link", { name: "Install extension", exact: true }),
    ).toHaveAttribute("href", /github\.com\/getopenpost\/.+#install$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
});
