import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

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

test("color picker samples source pixels with the keyboard", async ({ page }) => {
  await page.goto("/tools/image-color-picker");
  await dismissTelemetryConsent(page);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "pixels.png", mimeType: "image/png", buffer: await sampleImage() });
  const sampler = page.getByRole("button", { name: /^Image color sampler/ });
  await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#0000FF");
  await sampler.press("ArrowLeft");
  await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("#FF0000");
  await expect(sampler).toBeFocused();
});

test("clipboard image becomes a downloadable original-size file", async ({ page }) => {
  await page.goto("/tools/paste-image");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: /Drop, paste, or choose/ }).waitFor();
  const bytes = [...(await sampleImage())];
  const pending = page.waitForEvent("download");
  await page.evaluate((bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
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

test("find a converter, clear an empty search, and open Quick Cut", async ({ page }) => {
  await page.goto("/tools");
  await dismissTelemetryConsent(page);
  const main = page.getByRole("main");
  await main.getByLabel("Search free tools").fill("WebP to PNG");
  await expect(main.locator(".tool-row")).toHaveCount(1);
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
  await expect(main.locator(".tool-row")).toHaveCount(2);
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
