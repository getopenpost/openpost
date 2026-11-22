import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

test.describe("free media tools", () => {
  async function sampleImage(format: "png" | "webp" = "png") {
    const pixels = Buffer.alloc(32 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        pixels[i] = x < 16 ? 255 : 0;
        pixels[i + 2] = x >= 16 ? 255 : 0;
        pixels[i + 3] = x === 31 ? 0 : 255;
      }
    return sharp(pixels, { raw: { width: 32, height: 16, channels: 4 } })
      .toFormat(format, { lossless: true })
      .toBuffer();
  }

  test("WebP conversion downloads real original-size PNG with transparency", async ({ page }) => {
    await page.goto("/tools/webp-to-png");
    await dismissTelemetryConsent(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.webp",
      mimeType: "image/webp",
      buffer: await sampleImage("webp"),
    });
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG", exact: true }).click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe("sample.png");
    const bytes = await readFile((await file.path())!);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 32, height: 16, hasAlpha: true });
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(data[31 * 4 + 3]).toBe(0);
    await page.getByRole("button", { name: "Start over" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "broken.webp",
      mimeType: "image/webp",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByRole("alert")).toContainText(/damaged|decode|processed/i);
  });

  test("empty image recovery requests a fresh export and accepts a valid WebP afterwards", async ({
    page,
  }) => {
    await page.goto("/tools/webp-to-jpg");
    await dismissTelemetryConsent(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /Drop, paste, or choose a WEBP image/ }).click();
    await (
      await chooser
    ).setFiles({ name: "empty.webp", mimeType: "image/webp", buffer: Buffer.alloc(0) });
    await expect(page.getByRole("alert")).toContainText("empty", { timeout: 2000 });
    await expect(page.getByRole("alert")).toContainText("exporting it again");
    await expect(page.getByRole("alert")).not.toContainText("smaller than");
    await page.locator('input[type="file"]').setInputFiles({
      name: "valid.webp",
      mimeType: "image/webp",
      buffer: await sampleImage("webp"),
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download JPEG", exact: true })).toBeEnabled();
  });

  test("color picker previews source pixels and selects with mouse or keyboard", async ({
    page,
  }) => {
    await page.goto("/tools/image-color-picker");
    await dismissTelemetryConsent(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "pixels.png", mimeType: "image/png", buffer: await sampleImage() });
    const sampler = page.getByRole("button", { name: /^Image color sampler/ });
    await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#0000FF");
    const magnifier = page.getByTestId("image-color-picker-magnifier");
    await sampler.scrollIntoViewIfNeeded();
    const imageBounds = (await sampler.locator("img").boundingBox())!;
    const redX = Math.ceil(imageBounds.x + 15);
    const rowY = Math.ceil(imageBounds.y + 8);
    await page.mouse.move(redX, rowY);
    await expect(magnifier).toContainText("#FF0000");
    await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#0000FF");
    await page.mouse.click(redX, rowY);
    await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#FF0000");
    await expect(page.getByLabel("X pixel", { exact: true })).toHaveValue("16");
    await sampler.press("ArrowRight");
    await expect(magnifier).toContainText("#0000FF");
    await sampler.press("ArrowLeft");
    await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#FF0000");
    await expect(sampler).toBeFocused();
    await expect(magnifier).toContainText("#FF0000");
    await sampler.press("Enter");
    await expect(page.getByLabel("X pixel", { exact: true })).toHaveValue("16");
    await page.mouse.move(Math.ceil(imageBounds.x + 31), rowY);
    await expect(magnifier).toContainText("#00000000");
    await page.getByRole("heading", { level: 1 }).hover();
    await expect(magnifier).toBeHidden();
  });

  test("palette selection identifies its source and keyboard sampling returns to image pixels", async ({
    page,
  }) => {
    await page.goto("/tools/image-color-picker");
    await dismissTelemetryConsent(page);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "palette.png", mimeType: "image/png", buffer: await sampleImage() });
    const choice = page.getByRole("button", { name: /^Use #[0-9A-F]+/ }).first();
    await choice.focus();
    await choice.press("Enter");
    const selected = page.locator(".selected");
    await expect(selected).toContainText("Image palette", { timeout: 2000 });
    await expect(selected).not.toContainText("pixel");
    await page.setViewportSize({ width: 1280, height: 900 });
    const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
    const phone = await navigation.isVisible();
    if (phone) await navigation.click();
    const toggle = page.getByRole("button", { name: `Use light theme`, exact: true });
    if (await toggle.isVisible()) await toggle.click();
    if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await selected.scrollIntoViewIfNeeded();
    await expect(selected).toBeInViewport();
    await expect(selected).toContainText("Image palette");
    const sampler = page.getByRole("button", { name: /^Image color sampler/ });
    await sampler.focus();
    await sampler.press("ArrowLeft");
    await expect(selected).toContainText("pixel");
    await expect(selected).not.toContainText("Image palette");
  });

  test("clipboard image becomes a downloadable original-size file", async ({ page }) => {
    await page.goto("/tools/paste-image");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: /Drop, paste, or choose/ }).waitFor();
    const bytes = [...(await sampleImage())];
    const pending = page.waitForEvent("download");
    await page.evaluate((bytes) => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }),
      );
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true }));
    }, bytes);
    const downloaded = await pending;
    expect(downloaded.suggestedFilename()).toBe("pasted.png");
    expect(await sharp(await readFile((await downloaded.path())!)).metadata()).toMatchObject({
      width: 32,
      height: 16,
      format: "png",
    });
  });

  test("logo maker exports usable PNG and SVG", async ({ page }) => {
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Minimal", exact: true }).click();
    const icon = page.locator('svg[aria-label="Logo preview"] > svg');
    const initialWidth = Number(await icon.getAttribute("width"));
    await page.getByRole("slider", { name: "Icon size", exact: true }).press("End");
    expect(Number(await icon.getAttribute("width"))).toBeGreaterThan(initialWidth);
    let pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "SVG", exact: true }).click();
    const svg = await readFile((await (await pending).path())!, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("<rect");
    pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    const png = await readFile((await (await pending).path())!);
    expect(await sharp(png).metadata()).toMatchObject({
      format: "png",
      width: 1024,
      height: 1024,
      hasAlpha: true,
    });
    const stats = await sharp(png).stats();
    expect(stats.isOpaque).toBe(false);
    expect(stats.channels[3].max).toBeGreaterThan(0);
  });

  test("find a converter, clear an empty search, and open Quick Cut @mobile", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/tools");
    await dismissTelemetryConsent(page);
    const main = page.getByRole("main");
    if (isMobile) {
      const searchBounds = await main.getByLabel("Search free tools").boundingBox();
      expect(searchBounds?.height).toBeGreaterThanOrEqual(44);
    }
    await main.getByLabel("Search free tools").fill("WebP to PNG");
    await expect(main.getByRole("link")).toHaveCount(1);
    await main.getByRole("link", { name: /^WebP to PNG/ }).click();
    await expect(page).toHaveURL(/\/tools\/webp-to-png/);
    await expect(page).toHaveTitle(/WebP to PNG/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://openpo.st/tools/webp-to-png",
    );
    await page.goto("/tools");
    await main.getByLabel("Search free tools").fill("nonexistent-tool");
    await expect(main.getByRole("heading", { name: "No tools match that search." })).toBeVisible();
    await main.getByRole("button", { name: "Show all tools" }).click();
    await main.getByRole("button", { name: "Video", exact: true }).click();
    await expect(main.getByRole("link", { name: /^Quick Cut/ })).toBeVisible();
    await main.getByRole("link", { name: /^Quick Cut/ }).click();
    await expect(main.getByRole("link", { name: "Open Quick Cut" })).toHaveAttribute(
      "href",
      /^https:\/\/app\.openpo\.st\/quick-cut\?/,
    );
  });

  test("supported tool pages are discoverable without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${baseURL}/tools`);
    for (const slug of [
      "background-remover",
      "image-color-picker",
      "paste-image",
      "logo-maker",
      "quick-cut",
      "image-converter",
      "webp-to-png",
      "jpg-to-webp",
      "mp4-to-mkv",
      "audio-converter",
      "media-info",
    ]) {
      await expect(page.getByRole("main").locator(`a[href="/tools/${slug}"]`)).toHaveCount(1);
    }
    await page.goto(`${baseURL}/tools/webp-to-png`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("WebP to PNG");
    await expect(page.locator("noscript p")).toBeVisible();
    await expect(page.locator("noscript p")).toContainText("Turn on JavaScript to use this tool.");
    await expect(page.getByRole("heading", { name: "When to convert WebP to PNG" })).toBeVisible();
    await context.close();
  });

  test("conversion pages have distinct metadata and sitemap entries", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    for (const [slug, source, destination] of [
      ["png-to-jpg", "PNG", "JPEG"],
      ["png-to-webp", "PNG", "WebP"],
      ["jpg-to-png", "JPEG", "PNG"],
      ["jpg-to-webp", "JPEG", "WebP"],
      ["webp-to-png", "WebP", "PNG"],
      ["webp-to-jpg", "WebP", "JPEG"],
    ]) {
      const response = await request.get(`/tools/${slug}`);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(`Free ${source} to ${destination} converter, full resolution`);
      expect(html).toContain(`When to convert ${source} to ${destination}`);
      expect(html).toContain('"isAccessibleForFree":true');
      expect(sitemap).toContain(`<loc>https://openpo.st/tools/${slug}</loc>`);
    }
    expect((await request.get("/tools/unsupported-to-png")).status()).toBe(404);
  });
});

test.describe("background remover", () => {
  const FIXTURE_WIDTH = 1200;
  const FIXTURE_HEIGHT = 800;

  async function cutoutFixture(): Promise<Buffer> {
    return await sharp({
      create: {
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        channels: 4,
        background: "#f7f4ed",
      },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><circle cx="600" cy="310" r="180" fill="#e5622e"/><rect x="390" y="470" width="420" height="270" rx="90" fill="#283a36"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
  }

  test("downloads a transparent PNG at the original dimensions", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/tools/background-remover");
    await dismissTelemetryConsent(page);
    await page.getByLabel("Choose an image").setInputFiles({
      name: "cutout-browser-fixture.png",
      mimeType: "image/png",
      buffer: await cutoutFixture(),
    });

    const downloadButton = page.getByRole("button", { name: "Download PNG" });
    await expect(downloadButton).toBeVisible({ timeout: 110_000 });
    await expect(page.getByRole("img", { name: "Background removed" })).toBeVisible();
    const comparison = page.getByRole("slider", { name: "Compare original and result" });
    await expect(comparison).toHaveAttribute("aria-valuenow", "50");
    await comparison.press("ArrowRight");
    await expect(comparison).toHaveAttribute("aria-valuenow", "51");
    await expect(comparison.getByText("Original", { exact: true })).toBeVisible();
    await expect(comparison.getByText("Removed", { exact: true })).toBeVisible();
    const bounds = await comparison.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height / 2);
    await expect(comparison).toHaveAttribute("aria-valuenow", "75");

    const downloadEvent = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadEvent;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toBe("cutout-browser-fixture-no-background.png");
    expect(downloadPath).not.toBeNull();

    const image = sharp(downloadPath!);
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(FIXTURE_WIDTH);
    expect(metadata.height).toBe(FIXTURE_HEIGHT);
    expect(metadata.hasAlpha).toBe(true);
    const alpha = stats.channels[3];
    expect(alpha).toBeDefined();
    expect(alpha!.min).toBeLessThan(255);
    expect(alpha!.max).toBe(255);
  });
});

test.describe("download feedback", () => {
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

  test("converter reports a requested download without promising file delivery", async ({
    page,
  }) => {
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
});

test.describe("posting planner count", () => {
  test("posting planner explains invalid counts and recovers a usable schedule", async ({
    page,
  }) => {
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
    await page.setViewportSize({ width: 1280, height: 900 });
    const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
    const phone = await navigation.isVisible();
    if (phone) await navigation.click();
    const toggle = page.getByRole("button", { name: `Use light theme`, exact: true });
    if (await toggle.isVisible()) await toggle.click();
    if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    const guidance = page.getByRole("status");
    await guidance.scrollIntoViewIfNeeded();
    await expect(guidance).toBeInViewport();
    await expect(guidance).toContainText("Choose a whole number from 1 to 14");
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
});

test.describe("draft next action", () => {
  test("reviewed tool drafts keep their next action usable on a phone", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/tools/thread-splitter");
    await dismissTelemetryConsent(page);
    await page
      .getByLabel("Text to split into a thread")
      .fill("A launch lesson worth keeping in our own words.");
    await page.setViewportSize({ width: 1280, height: 900 });
    const theme = page.getByRole("button", { name: `Use light theme`, exact: true });
    if (await theme.count()) await theme.click();
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(page.locator("html")).toHaveClass(/^(?!.*\bdark\b)/);
    const action = page.getByRole("button", { name: "Schedule this thread", exact: true });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await action.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await action.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    expect(
      await action.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.boxShadow !== "none" ||
          (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0)
        );
      }),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe("marketing no javascript", () => {
  const toolRoutes = [
    "social-media-video-editor",
    "social-media-image-editor",
    "multi-platform-character-counter",
    "post-preview-generator",
    "thread-splitter",
    "fediverse-handle-checker",
    "linkedin-text-formatter",
    "best-time-to-post-calculator",
    "utm-link-builder",
  ];

  test.describe("browser tools without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("every tool keeps a useful guide and working questions", async ({ page }) => {
      for (const slug of toolRoutes) {
        await page.goto(`/tools/${slug}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "How to use it", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Common questions", exact: true }),
        ).toBeVisible();
        const question = page.getByRole("article").locator("details").first();
        await question.locator("summary").click();
        await expect(question.locator("p")).toBeVisible();
        const links = page.getByRole("link", { name: "All free tools", exact: true });
        await expect(links).toHaveAttribute("href", "/tools");
      }
    });
  });
});
