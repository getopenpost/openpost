import { expect, test, type Page } from "@playwright/test";
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

  test("local media selection uses the destination limit without silently discarding files", async ({
    page,
  }) => {
    await page.goto("/tools/post-preview-generator");
    await page.waitForLoadState("networkidle");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: /Post details/ }).click();
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=",
      "base64",
    );
    const files = Array.from({ length: 5 }, (_, index) => ({
      name: `photo-${index}.png`,
      mimeType: "image/png",
      buffer: image,
    }));
    await page.locator('input[type="file"]').setInputFiles(files);
    await expect(page.getByRole("alert")).toContainText("Choose up to 4 images");
    await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(0);
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    await select(page, "Platform", "LinkedIn");
    await page.getByRole("button", { name: /Post details/ }).click();
    await page.locator('input[type="file"]').setInputFiles(files);
    await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(5);
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    await page.getByRole("button", { name: "Platform", exact: true }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("exceeds the 4-image preview limit");
    await page.getByRole("button", { name: /Post details/ }).click();
    await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(5);
    await page.getByRole("button", { name: "Remove photo-2.png", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(4);
    await expect(
      page.getByRole("button", { name: "Remove photo-4.png", exact: true }),
    ).toBeVisible();
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

  test("an oversized poll keeps every option visible and explains the limit", async ({ page }) => {
    await page.goto("/tools/x-post-preview");
    await page.waitForLoadState("networkidle");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: /Post details/ }).click();
    await page.getByRole("checkbox", { name: "Include a poll" }).check();
    await page.getByLabel("Poll options, up to 4").fill("One\nTwo\nThree\nFour\nFive");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    await expect(page.getByLabel("Poll preview")).toContainText("Five");
    await expect(page.getByRole("status")).toContainText("poll exceeds the 4-option preview limit");
  });

  test("Story previews preserve the post draft and media while hiding unused copy", async ({
    page,
  }) => {
    await page.goto("/tools/instagram-post-preview");
    await page.waitForLoadState("networkidle");
    await dismissTelemetryConsent(page);
    await page.getByLabel("Post copy").fill("A caption for the feed, kept for later.");
    await page.getByRole("button", { name: /Post details/ }).click();
    await page.locator('input[type="file"]').setInputFiles(photoFixture);
    await page.getByLabel("Media alt text", { exact: true }).fill("A tram in Lisbon");
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    await select(page, "Format", "story");
    await expect(page.getByLabel("Post copy")).toHaveCount(0);
    await expect(
      page.getByText("Text must be part of your image or video.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("[data-preview-viewport]").getByRole("img", { name: "A tram in Lisbon" }),
    ).toBeVisible();
    await select(page, "Format", "post");
    await expect(page.getByLabel("Post copy")).toHaveValue(
      "A caption for the feed, kept for later.",
    );
    await expect(
      page.locator("[data-preview-viewport]").getByRole("img", { name: "A tram in Lisbon" }),
    ).toBeVisible();
  });
});

test.describe("social preview appearance", () => {
  const PALETTE_MIDPOINT = 128;

  async function choose(page: Page, name: string, option: string) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  }

  for (const host of ["dark", "light"] as const)
    test(`explicit preview appearance overrides ${host} host and browser preference`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.emulateMedia({ colorScheme: host, reducedMotion: "reduce" });
      await page.goto("/tools/linkedin-post-preview");
      await dismissTelemetryConsent(page);
      await expect(
        page.getByRole("button", { name: "Preview appearance", exact: true }),
      ).toBeVisible();
      const theme = page
        .locator("header.marketing-nav")
        .getByRole("button", { name: `Use ${host} theme`, exact: true });
      if (await theme.isVisible()) await theme.click();
      if (host === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      const hostClass = await page.locator("html").getAttribute("class");
      const networks = [
        "LinkedIn",
        "X",
        "Mastodon",
        "Pixelfed",
        "PeerTube",
        "Lemmy",
        "PieFed",
        "Bluesky",
        "Threads",
        "Instagram",
        "Facebook",
        "YouTube",
        "TikTok",
        "Discord",
        "Telegram",
        "Pinterest",
        "Reddit",
        "Google Business Profile",
      ];
      for (const network of networks) {
        await choose(page, "Platform", network);
        for (const view of ["Post card", "Full page"]) {
          await choose(page, "Preview view", view);
          const card = page.locator("[data-preview-viewport] .social-preview").first();
          const native = card.locator(":scope > *").first();
          const samples: Record<string, { card: number; shell: number | null }> = {};
          for (const appearance of ["Light", "Dark"]) {
            await choose(page, "Preview appearance", appearance);
            await expect(card).toHaveAttribute("data-preview-scheme", appearance.toLowerCase());
            await expect(card).toHaveCSS("color-scheme", appearance.toLowerCase());
            await expect(async () => {
              const sample = await native.evaluate((element) => {
                function brightness(node: Element) {
                  const value = getComputedStyle(node).backgroundColor;
                  const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
                  if (!rgb) throw new Error(`Expected an opaque native surface, received ${value}`);
                  return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3;
                }
                const shell = element.closest(".preview-page");
                return { card: brightness(element), shell: shell ? brightness(shell) : null };
              });
              const surfaces = network === "TikTok" ? [] : [sample.card];
              if (view === "Full page") {
                expect(sample.shell).not.toBeNull();
                surfaces.push(sample.shell!);
              }
              for (const surface of surfaces) {
                if (appearance === "Light") expect(surface).toBeGreaterThan(PALETTE_MIDPOINT);
                else expect(surface).toBeLessThan(PALETTE_MIDPOINT);
              }
              samples[appearance] = sample;
            }).toPass({ timeout: 5000 });
          }
          if (network !== "TikTok")
            expect(
              samples.Light.card - samples.Dark.card,
              `${network} ${view} native palette`,
            ).toBeGreaterThan(80);
          if (view === "Full page")
            expect(
              samples.Light.shell! - samples.Dark.shell!,
              `${network} page palette`,
            ).toBeGreaterThan(80);
        }
      }
      await choose(page, "Platform", "LinkedIn");
      await choose(page, "Preview appearance", "Light");
      await page.setViewportSize({ width: 1280, height: 900 });
      expect(
        await page
          .getByRole("region", { name: "Scrollable social preview" })
          .evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
          }),
      ).toBe(true);
      expect(await page.locator("html").getAttribute("class")).toBe(hostClass);
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
});
