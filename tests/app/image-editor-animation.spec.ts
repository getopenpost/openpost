import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { parseGIF } from "gifuct-js";

const gifPath = fileURLToPath(
  new URL("../../apps/web/src/lib/video-editor/media/fixtures/animated-rgb.gif", import.meta.url),
);

test("non-Latin tool keys preserve editable text and browser shortcuts", async ({ page }) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Design canvas", exact: true });
  await expect(canvas).toBeVisible();
  const tools = page.getByRole("navigation", { name: "OpenPost Image Editor tools", exact: true });
  await canvas.dispatchEvent("keydown", {
    key: "и",
    code: "KeyB",
    bubbles: true,
    cancelable: true,
  });
  await expect(tools.getByRole("button", { name: "Pencil", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await canvas.dispatchEvent("keydown", {
    key: "σ",
    code: "KeyV",
    bubbles: true,
    cancelable: true,
  });
  await expect(tools.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await canvas.dispatchEvent("keydown", {
    key: "لا",
    code: "KeyB",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await expect(tools.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const title = page.getByRole("textbox", { name: "Design title", exact: true });
  await title.fill("Пример");
  await title.dispatchEvent("keydown", { key: "и", code: "KeyB", bubbles: true, cancelable: true });
  await expect(title).toHaveValue("Пример");
  await expect(tools.getByRole("button", { name: "Select objects", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

for (const width of [1440, 320]) {
  for (const colorScheme of ["light"] as const) {
    test(`GIF frame editing and lens controls at ${width}px in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/image-editor");
      await page.getByLabel("Open an image", { exact: true }).setInputFiles(gifPath);
      await expect(page).toHaveURL(/\/image-editor\/local_design_/);
      await expect(
        page.getByRole("application", { name: "Design canvas", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`before-${width}-${colorScheme}.png`) });
      if (width < 1024) {
        await page
          .getByRole("navigation", { name: "OpenPost Image Editor tools", exact: true })
          .getByRole("button", { name: "Layers", exact: true })
          .click();
      }
      await page.getByRole("treeitem").filter({ hasText: "animated-rgb" }).click();
      if (width < 1024) {
        await page.keyboard.press("Escape");
        await page
          .getByRole("navigation", { name: "OpenPost Image Editor tools", exact: true })
          .getByRole("button", { name: "Properties", exact: true })
          .click();
      }
      await page.getByRole("button", { name: "Frame 2, 100 ms", exact: true }).click();
      await page.getByRole("button", { name: "Duplicate frame", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Animation frames", exact: true }).getByRole("button"),
      ).toHaveCount(4);
      await page.getByLabel("Frame duration (ms)", { exact: true }).fill("200");
      await page.keyboard.press("Tab");
      await page.getByRole("button", { name: "Lens effect", exact: true }).click();
      await page.getByRole("option", { name: "Starburst", exact: true }).click();
      await expect(
        page.getByRole("slider", { name: "Highlight threshold", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`after-${width}-${colorScheme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(errors).toEqual([]);
    });
  }
}

test("touch GIF edits persist across reload and download as an animated GIF", async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    hasTouch: true,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/image-editor`);
    await page.getByLabel("Open an image", { exact: true }).setInputFiles(gifPath);
    await expect(page).toHaveURL(/\/image-editor\/local_design_/);
    const tools = page.getByRole("navigation", {
      name: "OpenPost Image Editor tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Layers", exact: true }).tap();
    await page.getByRole("treeitem").filter({ hasText: "animated-rgb" }).tap();
    await page.keyboard.press("Escape");
    await tools.getByRole("button", { name: "Properties", exact: true }).tap();
    const duplicate = page.getByRole("button", { name: "Duplicate frame", exact: true });
    await duplicate.scrollIntoViewIfNeeded();
    expect((await duplicate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await duplicate.tap();
    await expect(
      page.getByRole("group", { name: "Animation frames", exact: true }).getByRole("button"),
    ).toHaveCount(4);
    await page.getByLabel("Frame duration (ms)", { exact: true }).fill("200");
    await page.getByRole("heading", { name: "GIF animation", exact: true }).tap();
    await page.screenshot({ path: testInfo.outputPath("gif-frames-touch-390-light.png") });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await duplicate.scrollIntoViewIfNeeded();
    expect((await duplicate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath("gif-frames-touch-320-dark.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("image-editor-save-indicator")).toHaveAttribute(
      "data-state",
      "saved",
    );
    await page.reload();
    await tools.getByRole("button", { name: "Layers", exact: true }).tap();
    await page.getByRole("treeitem").filter({ hasText: "animated-rgb" }).tap();
    await page.keyboard.press("Escape");
    await tools.getByRole("button", { name: "Properties", exact: true }).tap();
    await expect(
      page.getByRole("group", { name: "Animation frames", exact: true }).getByRole("button"),
    ).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Frame 2, 200 ms", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Export", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Export design", exact: true });
    await dialog.getByRole("button", { name: "Format", exact: true }).tap();
    await page.getByRole("option", { name: "GIF", exact: true }).tap();
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download", exact: true }).tap();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.gif$/);
    const buffer = await readFile((await download.path())!);
    const gif = parseGIF(Uint8Array.from(buffer).buffer);
    expect(gif.frames.flatMap((frame) => ("image" in frame ? [frame.gce.delay * 10] : []))).toEqual(
      [100, 200, 100, 100],
    );
  } finally {
    await context.close();
  }
});

test("cancelling a GIF drop during guest storage leaves no layer", async ({ page }) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const canvas = page.getByRole("application", { name: "Design canvas", exact: true });
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    let inspections = 0;
    const nativePost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      const send = nativePost.bind(this);
      const deliver = () =>
        Array.isArray(options) ? send(message, options) : send(message, options ?? {});
      if (message && message.decode === false && ++inspections === 2) {
        document.body.dataset.gifStorageHeld = "true";
        window.addEventListener(
          "message",
          (event) => {
            if (event.data === "release-gif-storage") deliver();
          },
          { once: true },
        );
      } else deliver();
    };
  });
  await page.evaluate(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], "cancelled.gif", { type: "image/gif" }));
      const canvas = document.querySelector('[role="application"][aria-label="Design canvas"]')!;
      const bounds = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
        }),
      );
    },
    Array.from(await readFile(gifPath)),
  );
  await expect(page.locator("body")).toHaveAttribute("data-gif-storage-held", "true");
  const progress = page.getByTestId("image-editor-import-progress");
  await progress.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => window.postMessage("release-gif-storage", "*"));
  await expect(progress).toBeHidden();
  await expect(page.getByRole("treeitem").filter({ hasText: "cancelled" })).toHaveCount(0);
});
