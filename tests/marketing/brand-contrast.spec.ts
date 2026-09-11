import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test("public logo remains legible when the visitor switches appearance", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await dismissTelemetryConsent(page);
  const header = page.locator("header.marketing-nav");
  const logo = header.getByRole("link", { name: "OpenPost home", exact: true }).locator("img");
  const colors = [];

  for (const scheme of ["light", "dark", "light"] as const) {
    const switchTheme = header.getByRole("button", {
      name: `Use ${scheme} theme`,
    });
    const navigation = header.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    if (await navigation.isVisible()) await navigation.click();
    if (await switchTheme.isVisible()) await switchTheme.click();
    const closeNavigation = header.getByRole("button", {
      name: "Close navigation",
      exact: true,
    });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

    const pixels = await logo.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 64, 64);
      return Array.from(context.getImageData(12, 12, 1, 1).data);
    });
    expect(pixels[3]).toBe(255);
    colors.push(pixels.slice(0, 3));
    const luminance = (rgb: number[]) =>
      rgb
        .map((value) => value / 255)
        .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const ink = luminance(pixels.slice(0, 3));
    const surface = luminance(scheme === "light" ? [255, 255, 255] : [13, 17, 23]);
    expect(
      (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    await expect(logo).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  expect(colors[0]).not.toEqual(colors[1]);
  expect(colors[2]).toEqual(colors[0]);
});
