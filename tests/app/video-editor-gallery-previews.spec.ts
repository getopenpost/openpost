import { expect, test } from "@playwright/test";

test("background and effect catalogs compile only the active preview", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).waitFor();
  await page.evaluate(() => {
    const metrics = { compiles: 0, draws: 0, compileMs: 0 };
    Object.assign(window, { catalogMetrics: metrics });
    const compile = WebGL2RenderingContext.prototype.compileShader;
    WebGL2RenderingContext.prototype.compileShader = function (shader) {
      const start = performance.now();
      compile.call(this, shader);
      metrics.compiles++;
      metrics.compileMs += performance.now() - start;
    };
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      metrics.draws++;
      draw.apply(this, args);
    };
  });
  const metrics = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            catalogMetrics: { compiles: number; draws: number; compileMs: number };
          }
        ).catalogMetrics,
    );
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  const backgrounds = page.getByRole("searchbox", { name: "Search backgrounds" });
  await backgrounds.fill("Warp");
  const warp = page.getByRole("button", { name: "Warp", exact: true });
  await expect(warp.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      warp
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  expect((await metrics()).compiles).toBe(0);
  await warp.hover();
  await expect(warp.locator("canvas")).toBeVisible();
  await expect.poll(async () => (await metrics()).draws).toBeGreaterThan(2);
  await backgrounds.hover();
  await expect(warp.locator("canvas")).toHaveCount(0);
  const stopped = await metrics();
  await page.waitForTimeout(250);
  expect((await metrics()).draws).toBe(stopped.draws);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await warp.focus();
  await page.waitForTimeout(250);
  await expect(warp.locator("canvas")).toHaveCount(0);
  expect((await metrics()).draws).toBe(stopped.draws);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await backgrounds.focus();
  await warp.focus();
  await expect(warp.locator("canvas")).toBeVisible();
  await backgrounds.focus();
  await backgrounds.fill("");
  await page.screenshot({ path: info.outputPath("background-gallery-after.png") });
  const beforeEffects = await metrics();
  await page
    .getByRole("tablist", { name: "Assets", exact: true })
    .getByRole("tab", { name: "Effects", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "Search effects", exact: true }).fill("Shaders");
  const heatmap = page.locator('[data-effect-catalog-id="gpu-paper-heatmap"]');
  await heatmap.scrollIntoViewIfNeeded();
  await expect(heatmap.locator("canvas")).toHaveAttribute("data-rendered", "true");
  expect((await metrics()).compiles).toBe(beforeEffects.compiles);
  await page.screenshot({ path: info.outputPath("shader-effects-after.png") });
  await heatmap.hover();
  await expect.poll(async () => (await metrics()).compiles).toBeGreaterThan(beforeEffects.compiles);
  await page.getByRole("searchbox", { name: "Search effects", exact: true }).hover();
  await page.waitForTimeout(250);
  const effectStopped = await metrics();
  await page.waitForTimeout(250);
  expect((await metrics()).draws).toBe(effectStopped.draws);
  expect(errors).toEqual([]);
  await info.attach("catalog-gpu-metrics", {
    body: JSON.stringify({
      idleBackgroundCompiles: 0,
      idleEffectCompiles: 0,
      hovered: effectStopped,
    }),
    contentType: "application/json",
  });
});
