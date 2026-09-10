import { expect, test, type Page } from "@playwright/test";

// IntersectionObserver rounds fractional CSS pixels at phone widths.
const FULLY_VISIBLE_RATIO = 0.999;

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
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible();
  await page.getByRole("textbox", { name: "Project name" }).fill("Shader proof");
  await page.getByRole("textbox", { name: "Project name" }).press("Tab");
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("button", { name: preset, exact: true }).click();
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
    await createShaderProject(page);
    await page.getByRole("slider", { name: "Speed", exact: true }).press("Home");
    await expect(page.getByRole("button", { name: "Neural", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Aurora", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Aurora", exact: true })).toBeFocused();
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
          for (const preset of ["Aurora", "Dusk", "Ribbons", "Monochrome", "Clouds", "Neural"]) {
            const tile = page.getByRole("button", { name: preset, exact: true });
            await tile.scrollIntoViewIfNeeded();
            await expect(tile).toBeInViewport({ ratio: FULLY_VISIBLE_RATIO });
            await expect(tile.getByText(preset, { exact: true })).toBeInViewport({
              ratio: FULLY_VISIBLE_RATIO,
            });
          }
        }
        if (name === "Edit") {
          await page.getByRole("slider", { name: "Starting phase" }).scrollIntoViewIfNeeded();
          await expect(page.getByRole("slider", { name: "Starting phase" })).toBeInViewport();
        }
        await page.screenshot({
          path: info.outputPath(`shaders-${scheme}-${width}-${name.toLowerCase()}.png`),
        });
      }
    }
    expect(errors).toEqual([]);
  });
}

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
