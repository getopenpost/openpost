import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test.use({ actionTimeout: 15_000 });

async function installLocalWorkspacePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        if (!("queryPermission" in prototype)) {
          Object.defineProperty(prototype, "queryPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        if (!("requestPermission" in prototype)) {
          Object.defineProperty(prototype, "requestPermission", {
            configurable: true,
            value: async () => "granted",
          });
        }
        return handle;
      },
    });
  });
}

async function createProject(
  page: Page,
  name: string,
  options: { selectLocalProjects?: boolean } = {},
): Promise<void> {
  await installLocalWorkspacePicker(page);
  await page.goto("/video-editor");
  if (options.selectLocalProjects) {
    await page.getByRole("button", { name: "Local only" }).click();
  }
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Custom project" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/video-editor\/[0-9a-f-]+$/u);
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ hasTouch: scheme === "dark" });
    test(`precise trimming and explicit media placement in ${scheme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
      await page.setViewportSize({ width: 1280, height: 800 });
      await createProject(page, "Precise editing");
      const bytes = (
        await readFile(
          fileURLToPath(new URL("./fixtures/product-screenshots/lisbon-tram.png", import.meta.url)),
        )
      ).toString("base64");
      await page.evaluate(async (bytes) => {
        const root = await navigator.storage.getDirectory();
        const imports = await root.getDirectoryHandle("test-imports", { create: true });
        const handle = await imports.getFileHandle("lisbon-tram.png", { create: true });
        const writable = await handle.createWritable();
        await writable.write(Uint8Array.from(atob(bytes), (character) => character.charCodeAt(0)));
        await writable.close();
        Object.defineProperty(window, "showOpenFilePicker", {
          configurable: true,
          value: async () => [handle],
        });
      }, bytes);
      await page.getByRole("button", { name: "Import media", exact: true }).click();
      await page
        .getByRole("button", { name: "More actions for lisbon-tram.png", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Add at playhead", exact: true }).click();
      const clips = page.locator("[data-timeline-item-id]");
      await expect(clips).toHaveCount(1);
      await clips
        .first()
        .getByRole("button", { name: /^lisbon-tram.png\. Drag/ })
        .click();
      if (scheme === "dark") {
        const track = page.locator('[data-track="track-video-overlay"]');
        const originalHeight = (await track.boundingBox())!.height;
        await track.getByRole("button", { name: "More track actions", exact: true }).click();
        const resize = page.getByRole("slider", {
          name: "Resize Visual 2 track height",
          exact: true,
        });
        await expect(resize).toBeVisible();
        expect((await resize.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(resize).toHaveAttribute("aria-valuenow", String(originalHeight));
        const box = (await resize.boundingBox())!;
        const touch = await page.context().newCDPSession(page);
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...point, y: point.y + 12 }],
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
        await expect
          .poll(async () => (await track.boundingBox())!.height)
          .toBeGreaterThan(originalHeight);
        await page.keyboard.press("Escape");
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(async () => (await track.boundingBox())!.height).toBe(originalHeight);
      }
      await page.getByRole("slider", { name: "Timeline playhead", exact: true }).focus();
      await page.keyboard.press("Home");
      for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
      await page.screenshot({ path: testInfo.outputPath(`trim-before-${scheme}.png`) });
      const trimStart = page.getByRole("button", { name: "Trim start to playhead", exact: true });
      await expect(trimStart).toBeEnabled();
      const original = (await clips.first().boundingBox())!;
      await trimStart.focus();
      await expect(trimStart).toBeFocused();
      await trimStart.press("Enter");
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeLessThan(original.width);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeCloseTo(original.width, 0);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        if (width < 768)
          await page
            .getByRole("navigation", { name: "Editor panels" })
            .getByRole("button", { name: "Edit", exact: true })
            .click();
        await trimStart.scrollIntoViewIfNeeded();
        await expect(trimStart).toBeInViewport();
        if (scheme === "dark")
          expect((await trimStart.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await trimStart.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({ path: testInfo.outputPath(`trim-${scheme}-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page
        .getByRole("button", { name: "More actions for lisbon-tram.png", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Add at end of sequence", exact: true }).click();
      await expect(clips).toHaveCount(2);
      await page.getByRole("button", { name: "Source: lisbon-tram.png", exact: true }).click();
      const append = page.getByRole("button", { name: "Add at end of sequence", exact: true });
      await expect(append).toHaveCount(1);
      await append.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`source-append-${scheme}.png`) });
      await append.click();
      await expect(clips).toHaveCount(3);
      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute(
        "data-state",
        "saved",
      );
      await page.reload();
      await expect(clips).toHaveCount(3);
      expect(errors).toEqual([]);
    });
  });
}
