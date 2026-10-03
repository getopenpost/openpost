import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        document.documentElement.dataset.requestedDownload = this.download;
        return;
      }
      click.call(this);
    };
  });
});

test("converter reports a requested download without promising file delivery", async ({ page }) => {
  await page.goto("/tools/image-converter");
  await dismissTelemetryConsent(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "feedback.png",
    mimeType: "image/png",
    buffer: await sharp({ create: { width: 32, height: 16, channels: 4, background: "red" } })
      .png()
      .toBuffer(),
  });
  const download = page.getByRole("button", { name: "Download PNG", exact: true });
  await expect(download).toBeEnabled();
  await download.focus();
  await download.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-requested-download", "feedback.png");
  await expect(
    page.getByText("Download started for feedback.png at 32 by 16 pixels.", { exact: true }),
  ).toHaveCount(1);
  await expect(download).toBeFocused();
});

test("logo reports PNG and SVG download requests", async ({ page }) => {
  await page.goto("/tools/logo-maker");
  await dismissTelemetryConsent(page);
  for (const format of ["SVG", "PNG"]) {
    const download = page.getByRole("button", { name: format, exact: true });
    await download.focus();
    await download.press("Enter");
    await expect(page.getByText(`${format} download started.`, { exact: true })).toBeVisible({
      timeout: 2000,
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-requested-download",
      new RegExp(`\\.${format.toLowerCase()}$`),
    );
    if (format === "SVG") await expect(download).toBeFocused();
  }
});
