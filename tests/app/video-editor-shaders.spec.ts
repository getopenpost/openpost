import { expect, test, type Page } from "@playwright/test";

// IntersectionObserver rounds fractional CSS pixels at phone widths.
const FULLY_VISIBLE_RATIO = 0.999;

async function expectRenderedShader(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect
    .poll(() =>
      page.locator("canvas[data-stacked-preview]").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 100) return true;
        }
        return false;
      }),
    )
    .toBe(true);
}

async function createShaderProject(page: Page, preset = "Aurora") {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        prototype.queryPermission = async () => "granted";
        prototype.requestPermission = async () => "granted";
        return handle;
      },
    });
  });
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("textbox", { name: "Project name" }).fill("Shader proof");
  await page.getByRole("textbox", { name: "Project name" }).press("Tab");
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search backgrounds" }).fill(preset);
  await page.getByRole("button", { name: preset, exact: true }).click();
  await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("");
  await expect(page.getByRole("button", { name: "Preset", exact: true })).toHaveText(preset);
}

test("shader clips preserve edits, seek and export an MP4", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createShaderProject(page);
  const canvas = page.locator("canvas[data-stacked-preview]");
  const initial = await canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByRole("button", { name: "Step one frame forward", exact: true }).click();
  await expect
    .poll(() => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .not.toBe(initial);
  await page.getByRole("button", { name: "Go to start", exact: true }).click();
  await expect
    .poll(() => canvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
    .toBe(initial);
  const speed = page.getByRole("slider", { name: "Speed", exact: true });
  await speed.press("Home");
  await expect(speed).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("slider", { name: "Starting phase" }).press("ArrowRight");
  await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
    "aria-valuenow",
    "0.1",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("slider", { name: "Starting phase" })).toHaveAttribute(
    "aria-valuenow",
    "0.1",
  );
  await speed.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("All changes saved locally", { exact: true })).toBeVisible();
  const projectURL = page.url();
  await page.goto("/video-editor");
  await page.goto(projectURL);
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  await expect(canvas).toBeVisible();
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export MP4", exact: true }).click();
  await expect(
    page.getByText("Saved Shader proof.mp4 to the exports folder.", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const download = page.getByRole("button", { name: "Download Shader proof.mp4", exact: true });
  await expect(download).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  await file.saveAs(test.info().outputPath("shader-proof.mp4"));
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`shader gallery and controls fit desktop and phones in ${scheme}`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.addInitScript((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await createShaderProject(page, "Warp");
    await page.getByRole("slider", { name: "Warp: Speed", exact: true }).press("Home");
    await expect(page.getByRole("button", { name: "Neural", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Aurora", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Aurora", exact: true })).toBeFocused();
    await expectRenderedShader(page);
    await page.screenshot({ path: info.outputPath(`shaders-${scheme}-1440.png`) });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const panels = page.getByRole("navigation", { name: "Editor panels" });
      for (const name of ["Assets", "Edit", "Program"]) {
        await panels.getByRole("button", { name, exact: true }).click();
        await expect(panels.getByRole("button", { name, exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        if (name === "Assets") {
          for (const preset of ["Aurora", "Warp", "God rays", "Static radial gradient"]) {
            await page.getByRole("searchbox", { name: "Search backgrounds" }).fill(preset);
            const tile = page.getByRole("button", { name: preset, exact: true });
            await tile.scrollIntoViewIfNeeded();
            await expect(tile).toBeInViewport({ ratio: FULLY_VISIBLE_RATIO });
            await expect(tile.getByText(preset, { exact: true })).toBeInViewport({
              ratio: FULLY_VISIBLE_RATIO,
            });
          }
        }
        if (name === "Edit") {
          await page
            .getByRole("button", { name: "Warp: Shape", exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole("button", { name: "Warp: Shape", exact: true }),
          ).toBeInViewport();
        }
        await expectRenderedShader(page);
        await page.screenshot({
          path: info.outputPath(`shaders-${scheme}-${width}-${name.toLowerCase()}.png`),
        });
      }
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1440) {
        await page
          .getByRole("navigation", { name: "Editor panels" })
          .getByRole("button", { name: "Assets", exact: true })
          .click();
      }
      await page
        .getByRole("tablist", { name: "Assets", exact: true })
        .getByRole("tab", { name: "Effects", exact: true })
        .click();
      await page.getByRole("searchbox", { name: "Search effects", exact: true }).fill("Shaders");
      await expect(page.locator('[data-effect-catalog-id^="gpu-paper-"]')).toHaveCount(10);
      const heatmap = page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]');
      await heatmap.scrollIntoViewIfNeeded();
      await expect(heatmap.locator("canvas")).toHaveAttribute("data-rendered", "true");
      const tile = page.locator('[data-effect-catalog-id="gpu-paper-gem-smoke"]');
      await tile.evaluate((element) =>
        element.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      await expect(tile).toBeInViewport({ ratio: FULLY_VISIBLE_RATIO });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await expectRenderedShader(page);
      await page.screenshot({ path: info.outputPath(`paper-effects-${scheme}-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

test("Paper backgrounds and chained shader effects survive reopening and export", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createShaderProject(page, "Warp");
  const colors = page.getByRole("slider", { name: "Warp: Colors", exact: true });
  await colors.press("ArrowLeft");
  await expect(colors).toHaveAttribute("aria-valuenow", "3");
  await page.getByRole("button", { name: "Warp: Shape", exact: true }).click();
  await page.getByRole("option", { name: "Stripes", exact: true }).click();
  await page.locator("[data-timeline-item-id]").first().click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText("Checks");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText(
    "Stripes",
  );
  await page
    .getByRole("tablist", { name: "Assets", exact: true })
    .getByRole("tab", { name: "Effects", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "Search effects", exact: true });
  await search.fill("Shaders");
  await expect(page.locator('[data-effect-catalog-id^="gpu-paper-"]')).toHaveCount(10);
  await page.locator('[data-effect-catalog-id="gpu-paper-water"]').click();
  await page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]').click();
  await page.locator('[data-edit-inspector-tab="effects"]').click();
  await page.getByRole("button", { name: "Heatmap: Logo source", exact: true }).click();
  await page.getByRole("option", { name: "Dark areas", exact: true }).click();
  // Heatmap's warm contours must replace the purple source in the settled preview.
  await expect
    .poll(() =>
      page.locator("canvas[data-stacked-preview]").evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("2d")!;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let warmPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! > 180 && pixels[i + 1]! > 120 && pixels[i + 2]! < 90) warmPixels++;
        }
        return warmPixels;
      }),
    )
    .toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath("paper-effect-controls.png") });
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("All changes saved locally", { exact: true })).toBeVisible();
  const projectURL = page.url();
  await page.goto("/video-editor");
  await page.goto(projectURL);
  await page.locator("[data-timeline-item-id]").first().click();
  await expect(page.getByRole("slider", { name: "Warp: Colors", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "3",
  );
  await expect(page.getByRole("button", { name: "Warp: Shape", exact: true })).toHaveText(
    "Stripes",
  );
  await page.locator('[data-edit-inspector-tab="effects"]').click();
  await expect(page.getByRole("button", { name: "Heatmap: Logo source", exact: true })).toHaveText(
    "Dark areas",
  );
  await page.locator("header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export MP4", exact: true }).click();
  await expect(
    page.getByText("Saved Shader proof.mp4 to the exports folder.", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Shader proof.mp4", exact: true }).click(),
  ]);
  await file.saveAs(test.info().outputPath("paper-shader-chain.mp4"));
  expect(errors).toEqual([]);
});

test("unavailable graphics prevents shader insertion from the gallery and inspector", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const getContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (kind, ...args) {
      if (kind === "webgl2") return null;
      return getContext.call(this, kind, ...args);
    } as typeof getContext;
  });
  await createShaderProject(page, "Sunset mesh");
  await expect(page.getByRole("button", { name: "Aurora", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Preset", exact: true }).click();
  await expect(page.getByRole("option", { name: "Aurora", exact: true })).toBeDisabled();
  await expect(page.getByRole("option", { name: "Ocean mesh", exact: true })).toBeEnabled();
});
