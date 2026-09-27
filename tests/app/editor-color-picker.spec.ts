import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`Image Editor previews pixels before selection in ${colorScheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/image-editor");
    await page.getByRole("button", { name: "How-to carousel", exact: true }).click();
    await page.getByRole("button", { name: "Eyedropper", exact: true }).click();
    await page.getByRole("button", { name: "Composite page", exact: true }).click();
    const surface = page.getByTestId("image-editor-selection-surface");
    const preview = page.getByTestId("image-editor-eyedropper-magnifier");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await surface.hover();
      await expect(preview).toBeVisible();
      const bounds = (await preview.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      await page.screenshot({ path: testInfo.outputPath(`picker-${colorScheme}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await surface.hover();
    const color = (await preview.innerText()).trim();
    await surface.click();
    await expect(page.getByText(new RegExp(`^Sampled ${color} at`))).toBeVisible();
    await page.getByRole("button", { name: "Eyedropper", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(preview).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
  });
}
