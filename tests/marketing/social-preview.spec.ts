import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";
import { readFile } from "node:fs/promises";

test.describe("social preview tools", () => {
  const photoFixture = "tests/app/fixtures/product-screenshots/lisbon-tram.png";

  async function select(page: import("@playwright/test").Page, name: string, option: string) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }

  test("preview workspace keeps the draft when changing screen, appearance, and view", async ({
    page,
  }) => {
    await page.goto("/tools");
    await page.waitForLoadState("networkidle");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Previews", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search free tools" }).fill("LinkedIn");
    await page.getByRole("link", { name: /LinkedIn post preview/ }).click();
    await expect(
      page.getByRole("heading", { name: "LinkedIn post preview", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Post copy").fill("A launch worth explaining in our own words.");
    await expect(page.locator("[data-preview-viewport]")).toContainText(
      "A launch worth explaining",
    );
    await select(page, "Preview screen width", "Small phone · 320px");
    await expect(page.locator("[data-preview-viewport]")).toHaveCSS("width", "320px");
    await select(page, "Preview appearance", "Dark");
    await select(page, "Preview view", "Post card");
    await expect(page.locator('[aria-label="LinkedIn post preview"]')).toContainText(
      "A launch worth explaining in our own words.",
    );
    await expect(page.getByLabel("Post copy")).toHaveValue(
      "A launch worth explaining in our own words.",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test("channel and carousel previews accept mixed photo and video attachments", async ({
    page,
  }) => {
    await page.goto("/tools/discord-post-preview");
    await page.waitForLoadState("networkidle");
    await dismissTelemetryConsent(page);
    for (const platform of ["Instagram", "Discord", "Threads", "Telegram"]) {
      await select(page, "Platform", platform);
      await page.getByRole("button", { name: /Post details/ }).click();
      await page
        .locator('input[type="file"]')
        .setInputFiles([photoFixture, "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"]);
      await expect(
        page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Remove study-sos-demo.mp4", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.getByRole("button", { name: "View preview", exact: true }).click();
      if (platform === "Instagram") {
        const preview = page.locator("[data-preview-viewport]");
        await preview.getByRole("button", { name: "Next media", exact: true }).click();
        await expect(preview.locator("video")).toBeVisible();
        await expect(preview.locator("video")).toHaveAttribute("src", /^blob:/);
        for (const format of ["story", "reel"]) {
          await select(page, "Format", format);
          await page.getByRole("button", { name: /Post details/ }).click();
          await page
            .locator('input[type="file"]')
            .setInputFiles([
              photoFixture,
              "tests/app/fixtures/product-screenshots/study-sos-demo.mp4",
            ]);
          await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
          await page.getByRole("button", { name: "View preview", exact: true }).click();
        }
        await select(page, "Format", "post");
      }
    }
    await select(page, "Format", "video");
    await expect(page.getByRole("alert")).toContainText("hidden from the preview");
    await page.getByRole("button", { name: /Post details/ }).click();
    await expect(
      page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove study-sos-demo.mp4", exact: true }),
    ).toBeVisible();
  });
});

test.describe("preview image admission", () => {
  test("a damaged local image leaves the current preview intact and explains recovery", async ({
    page,
  }) => {
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
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    const mobileMenu = page.getByRole("button", { name: "Open navigation", exact: true });
    const phone = await mobileMenu.isVisible();
    if (phone) await mobileMenu.click();
    const toggle = page.getByRole("button", { name: `Use light theme`, exact: true });
    if (await toggle.isVisible()) await toggle.click();
    if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await expect(page.locator("html")).not.toHaveClass(/(?:^| )dark(?: |$)/);
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
      .toBeLessThanOrEqual(1280 + 1);
    await input.setInputFiles("tests/app/fixtures/product-screenshots/lisbon-tram.png");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    const image = page.locator('[data-preview-viewport] img[src^="blob:"]');
    await expect
      .poll(() =>
        image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0),
      )
      .toBe(true);
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
});
