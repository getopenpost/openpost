import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("PNG export keeps keyboard focus and rejects repeated requests while encoding", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      document.documentElement.dataset.encodingRequested = "true";
      document.addEventListener(
        "release-png-encoding",
        () => encode.call(this, callback, type, quality),
        { once: true },
      );
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download)
        document.documentElement.dataset.downloadRequests = String(
          Number(document.documentElement.dataset.downloadRequests ?? 0) + 1,
        );
    };
  });
  await page.goto("/tools/logo-maker");
  await dismissTelemetryConsent(page);
  const png = page.getByRole("button", { name: "PNG", exact: true });
  await png.focus();
  await png.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-encoding-requested", "true");
  await expect(png).toBeFocused({ timeout: 2000 });
  await expect(png).toHaveAttribute("aria-disabled", "true");
  await png.press("Enter");
  await page.evaluate(() => document.dispatchEvent(new Event("release-png-encoding")));
  await expect(page.getByText("PNG download started.", { exact: true })).toBeVisible();
  await expect(png).toHaveAttribute("aria-disabled", "false");
  await expect(png).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-download-requests", "1");
});
