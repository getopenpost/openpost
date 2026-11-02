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
    await page.getByRole("button", { name: "This device" }).click();
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
        // Raw CDP touch skips actionability checks. Wait for menu placement to settle.
        await resize.click({ trial: true });
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
      const clipOverflow = page.getByRole("button", {
        name: "lisbon-tram.png: More actions",
        exact: true,
      });
      await clipOverflow.click();
      const trimStart = page.getByRole("menuitem", { name: "Trim start to playhead", exact: true });
      await expect(trimStart).toBeEnabled();
      const original = (await clips.first().boundingBox())!;
      await trimStart.click();
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeLessThan(original.width);
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => (await clips.first().boundingBox())!.width)
        .toBeCloseTo(original.width, 0);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await clipOverflow.scrollIntoViewIfNeeded();
        await expect(clipOverflow).toBeInViewport();
        if (scheme === "dark")
          expect((await clipOverflow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await clipOverflow.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
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
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const panels = page.getByRole("navigation", { name: "Editor panels" });
        await panels.getByRole("button", { name: "Media", exact: true }).click();
        const sourceCard = page.getByRole("button", {
          name: "Source: lisbon-tram.png",
          exact: true,
        });
        if (width === 390) await sourceCard.click();
        else {
          await sourceCard.focus();
          await sourceCard.press("Enter");
        }
        await expect(panels.getByRole("button", { name: "Timeline", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(page.getByRole("region", { name: "Source", exact: true })).toBeVisible();
        const close = page.getByRole("button", { name: "Close source monitor", exact: true });
        await expect(close).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath(`source-open-${scheme}-${width}.png`) });
        await close.click();
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole("button", { name: "Source: lisbon-tram.png", exact: true }).click();
      const source = page.getByRole("region", { name: "Source", exact: true });
      const position = source.getByRole("slider", { name: "Source position", exact: true });
      const inPoint = source.getByRole("slider", { name: "Source in point", exact: true });
      const outPoint = source.getByRole("slider", { name: "Source out point", exact: true });
      await source.getByRole("button", { name: "Go to end", exact: true }).click();
      await expect(position).toHaveAttribute("aria-valuenow", "89");
      await position.focus();
      await page.keyboard.press("Home");
      await expect(position).toHaveAttribute("aria-valuenow", "0");
      await inPoint.focus();
      await page.keyboard.press("ArrowRight");
      await expect(inPoint).toHaveAttribute("aria-valuenow", "1");
      await page.keyboard.press("Home");
      await expect(inPoint).toHaveAttribute("aria-valuenow", "0");
      await outPoint.focus();
      await page.keyboard.press("Home");
      await expect(outPoint).toHaveAttribute("aria-valuenow", "1");
      await page.keyboard.press("End");
      await expect(outPoint).toHaveAttribute("aria-valuenow", "90");
      await page.screenshot({ path: testInfo.outputPath(`source-keyboard-${scheme}.png`) });
      const append = page.getByRole("button", { name: "Add at end of sequence", exact: true });
      await expect(append).toHaveCount(1);
      await append.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`source-append-${scheme}.png`) });
      await append.click();
      await expect(clips).toHaveCount(3);
      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByRole("banner").locator('[role="status"][data-state]')).toHaveAttribute(
        "data-state",
        "saved",
      );
      await page.reload();
      await expect(clips).toHaveCount(3);
      expect(errors).toEqual([]);
    });
  });
}

test("clip overflow trims the second half after splitting and trimming the first", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await createProject(page, "Split overflow");
  const bytes = (
    await readFile(
      fileURLToPath(new URL("./fixtures/product-screenshots/study-sos-demo.mp4", import.meta.url)),
    )
  ).toString("base64");
  await page.evaluate(async (bytes) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("study-sos-demo.mp4", { create: true });
    const writable = await handle.createWritable();
    await writable.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
    await writable.close();
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [handle],
    });
  }, bytes);
  await page.getByRole("button", { name: "Import media", exact: true }).click();
  await page
    .getByRole("button", { name: "More actions for study-sos-demo.mp4", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add at playhead", exact: true }).click();
  const clips = page.locator("[data-timeline-item-id]");
  await expect(clips).toHaveCount(1);
  const firstID = await clips.first().getAttribute("data-timeline-item-id");
  const first = page.locator(`[data-timeline-item-id="${firstID}"]`);
  const seek = async (frame: number) => {
    const ruler = page.getByRole("slider", { name: "Timeline playhead", exact: true });
    await ruler.focus();
    await ruler.press("Home");
    for (let n = 0; n < Math.floor(frame / 10); n++) await ruler.press("Shift+ArrowRight");
    for (let n = 0; n < frame % 10; n++) await ruler.press("ArrowRight");
  };
  await seek(180);
  await first.getByRole("button", { name: /Drag to move/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Split at playhead/ }).click();
  await expect(clips).toHaveCount(2);
  const second = clips.last();
  await first.getByRole("button", { name: /Drag to move/ }).click();
  await seek(165);
  const more = page.getByRole("button", { name: "study-sos-demo.mp4: More actions", exact: true });
  await more.click();
  await page.getByRole("menuitem", { name: "Trim end to playhead", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await second.getByRole("button", { name: /Drag to move/ }).click();
  await seek(195);
  const before = (await second.boundingBox())!;
  await more.click();
  await page.getByRole("menuitem", { name: "Trim start to playhead", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(async () => (await second.boundingBox())!.width).toBeLessThan(before.width);
  await page.screenshot({ path: testInfo.outputPath("second-trim.png") });
});
