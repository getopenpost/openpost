import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";
import { readFile } from "node:fs/promises";

test("a damaged local image leaves the current preview intact and explains recovery", async ({
  page,
}, testInfo) => {
  await page.goto("/tools/instagram-post-preview");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "story", exact: true }).click();
  await page.getByRole("button", { name: /Post details/ }).click();
  const input = page.locator('input[type="file"]');
  const initialChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose local media", exact: true }).click();
  await (await initialChooser).setFiles("tests/app/fixtures/product-screenshots/lisbon-tram.png");
  await expect(
    page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
  ).toBeVisible();
  const damagedChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose local media", exact: true }).click();
  await (
    await damagedChooser
  ).setFiles({
    name: "damaged.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("could not be decoded", { timeout: 2000 });
  await expect(page.getByRole("alert")).toContainText("current media is unchanged");
  await expect(
    page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove damaged.png", exact: true })).toHaveCount(
    0,
  );
  for (const width of [1280, 390, 320]) {
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "View preview", exact: true }).click();
      await page.setViewportSize({ width, height: 900 });
      const mobileMenu = page.getByRole("button", { name: "Open navigation", exact: true });
      const phone = await mobileMenu.isVisible();
      if (phone) await mobileMenu.click();
      const toggle = page.getByRole("button", { name: `Use ${theme} theme`, exact: true });
      if (await toggle.isVisible()) await toggle.click();
      if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/(?:^| )dark(?: |$)/);
      else await expect(page.locator("html")).not.toHaveClass(/(?:^| )dark(?: |$)/);
      await page.getByRole("button", { name: /Post details/ }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      await alert.scrollIntoViewIfNeeded();
      await expect(alert).toBeInViewport();
      await expect
        .poll(() => alert.evaluate((node) => node.getBoundingClientRect().left))
        .toBeGreaterThanOrEqual(0);
      await expect
        .poll(() => alert.evaluate((node) => node.getBoundingClientRect().right))
        .toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: testInfo.outputPath(`image-recovery-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await input.setInputFiles("tests/app/fixtures/product-screenshots/lisbon-tram.png");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  const image = page.locator('[data-preview-viewport] img[src^="blob:"]');
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
    .toBe(true);
});

test("preview images retain GIF and SVG support", async ({ page }) => {
  await page.goto("/tools/instagram-post-preview");
  await dismissTelemetryConsent(page);
  for (const file of [
    {
      name: "picture.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
    },
    {
      name: "vector.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="14"><rect width="22" height="14" fill="red"/></svg>',
      ),
    },
  ]) {
    await page.getByRole("button", { name: /Post details/ }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(
      page.getByRole("button", { name: `Remove ${file.name}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    const image = page.locator('[data-preview-viewport] img[src^="blob:"]');
    await expect
      .poll(() =>
        image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
  }
});

test("a delayed image check cannot overwrite a later selection", async ({ page }) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    let holdFirstLocalImage = true;
    let release: (() => void) | undefined;
    let firstCheck: Promise<void> | undefined;
    Object.assign(window, {
      releasePreviewImageCheck: async () => {
        release?.();
        await firstCheck;
      },
    });
    HTMLImageElement.prototype.decode = function () {
      if (holdFirstLocalImage && this.src.startsWith("blob:")) {
        holdFirstLocalImage = false;
        firstCheck = new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => decode.call(this));
        return firstCheck;
      }
      return decode.call(this);
    };
  });
  await page.goto("/tools/instagram-post-preview");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: /Post details/ }).click();
  const input = page.locator('input[type="file"]');
  const buffer = await readFile("tests/app/fixtures/product-screenshots/lisbon-tram.png");
  await input.setInputFiles({ name: "earlier.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("status")).toContainText("Checking local images");
  await input.setInputFiles({ name: "later.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("button", { name: "Remove later.png", exact: true })).toBeVisible();
  await page.evaluate(() =>
    (
      window as typeof window & { releasePreviewImageCheck: () => Promise<void> }
    ).releasePreviewImageCheck(),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole("button", { name: "Remove later.png", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove earlier.png", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});
