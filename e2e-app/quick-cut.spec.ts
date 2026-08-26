import { expect, test } from "@playwright/test";
import { stat } from "node:fs/promises";
import path from "node:path";

test("quick cut loads with accessible controls and no overflow at 320/390/desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/quick-cut");
    await expect(page.getByRole("heading", { name: /No video open/i })).toBeVisible();
    const openBtn = page.getByRole("button", { name: /Open videos/i });
    await expect(openBtn).toBeVisible();
    const box = await openBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.waitForTimeout(200);
    expect(errors.filter((e) => !e.includes("Failed to load resource"))).toEqual([]);
  }
});

test("quick cut imports real media, creates a range, and never fakes Send", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/quick-cut");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Open videos/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(
    path.resolve("frontend/src/lib/video-editor/media/fixtures/prores-proxy.mov"),
  );

  await expect(page.getByText(/prores-proxy\.mov/i).first()).toBeVisible();
  await page.getByRole("button", { name: /^I · In$/i }).click();
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.currentTime = Math.min(0.08, video.duration || 0.08);
    video.dispatchEvent(new Event("timeupdate"));
  });
  await page.getByRole("button", { name: /^O · Out$/i }).click();
  await page.getByRole("button", { name: /Add segment/i }).click();
  await expect(page.getByRole("button", { name: /Segment 1/i })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mov$/i);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect((await stat(downloadedPath!)).size).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Send to OpenPost/i }).click();
  await expect(page.getByText(/Choose an OpenPost workspace before sending/i)).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(consoleErrors.filter((error) => !error.includes("Failed to load resource"))).toEqual([]);
});
