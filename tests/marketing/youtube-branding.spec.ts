import { expect, test, type Locator } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

async function expectYouTubeMark(artwork: Locator) {
  await expect.soft(artwork).toBeVisible();
  if ((await artwork.count()) === 0) return;
  await artwork.scrollIntoViewIfNeeded();
  const geometry = await artwork.evaluate(async (node: HTMLImageElement) => {
    await node.decode();
    const box = node.getBoundingClientRect();
    const parent = node.parentElement!.getBoundingClientRect();
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(box.width * scale);
    canvas.height = Math.ceil(box.height * scale);
    const context = canvas.getContext("2d")!;
    context.drawImage(node, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = canvas.height;
    let last = -1;
    let left = canvas.width;
    let right = -1;
    let red = 0;
    let white = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i + 3] < 128) continue;
        first = Math.min(first, y);
        last = Math.max(last, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
        if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 51) red++;
        if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
      }
    }
    return {
      paintedHeight: (last - first + 1) / scale,
      paintedAspect: (right - left + 1) / (last - first + 1),
      clearLeft: left / scale,
      clearRight: (canvas.width - right - 1) / scale,
      red,
      white,
      width: box.width,
      height: box.height,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      parentLeft: parent.left,
      parentRight: parent.right,
      parentTop: parent.top,
      parentBottom: parent.bottom,
    };
  });
  expect(geometry.paintedHeight).toBeGreaterThanOrEqual(20);
  expect(geometry.paintedHeight).toBeLessThanOrEqual(28);
  expect(geometry.width).toBeLessThanOrEqual(56);
  expect(geometry.height).toBeLessThanOrEqual(48);
  expect(geometry.paintedAspect).toBeGreaterThan(1.4);
  expect(geometry.paintedAspect).toBeLessThan(1.45);
  expect(geometry.clearLeft).toBeGreaterThanOrEqual(9);
  expect(geometry.clearRight).toBeGreaterThanOrEqual(9);
  expect(geometry.red).toBeGreaterThan(1000);
  expect(geometry.white).toBeGreaterThan(100);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.parentTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.parentBottom);
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [320, 1440]) {
    test(`YouTube marketing branding fits ${width}px in ${colorScheme} @desktop`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      await dismissTelemetryConsent(page);
      const resources = page.locator('a.platforms[href="/platforms"]');
      await expect.soft(resources.locator(".platform-art img")).toHaveCount(5);
      await expectYouTubeMark(resources.locator(".youtube-brand"));
      await resources.screenshot({ path: info.outputPath("channel-logos.png") });
      if (width === 1440) {
        await page.getByRole("button", { name: "Channels", exact: true }).click();
        const destination = page.locator('.platform-menu a[href="/platforms/youtube"]');
        await expect(destination).toContainText("YouTube");
        const emptyFrames = await destination.evaluate(
          (link) =>
            [...link.querySelectorAll("span")].filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.width > 0 &&
                Math.abs(rect.width - rect.height) < 1 &&
                parseFloat(getComputedStyle(node).borderTopWidth) > 0 &&
                !node.textContent?.trim() &&
                !node.querySelector("img, svg")
              );
            }).length,
        );
        expect.soft(emptyFrames).toBe(0);
        await expectYouTubeMark(destination.locator(".youtube-brand"));
        await destination.screenshot({ path: info.outputPath("channel-navigation.png") });
      }
      await page.goto("/platforms");
      const card = page.locator('a.channel[href="/platforms/youtube"]');
      await expectYouTubeMark(card.locator(".youtube-brand"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await card.screenshot({ path: info.outputPath("youtube-channel-card.png") });
    });
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Channels menu stays reachable at 700px height in ${colorScheme} @desktop`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Channels", exact: true }).click();
    const panel = page.locator(".platform-menu");
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect.soft(bounds!.y).toBeGreaterThanOrEqual(0);
    expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
    const lastChannel = panel.locator('a[href^="/platforms/"]').last();
    await lastChannel.scrollIntoViewIfNeeded();
    await expect.soft(lastChannel).toBeInViewport({ ratio: 1 });
    expect.soft(await panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("channels-short-window.png") });
  });
}
