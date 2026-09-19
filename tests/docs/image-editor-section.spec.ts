import { expect, test } from "@playwright/test";

const pages = [
  ["/image-editor", "Image Editor"],
  ["/image-editor/create-a-design", "Create a design"],
  ["/image-editor/editor-layout", "Editor layout"],
  ["/image-editor/layers", "Layers"],
  ["/image-editor/pages-and-carousels", "Pages and carousels"],
  ["/image-editor/color-and-effects", "Color and effects"],
  ["/image-editor/templates-and-brand", "Templates and brand items"],
  ["/image-editor/export-and-publish", "Export and publish"],
  ["/image-editor/saving-and-recovery", "Saving and recovery"],
  ["/image-editor/limits", "Limits"],
] as const;

test("every Image Editor guide renders and its section links resolve", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  await page.goto("/image-editor");
  const links = await page
    .locator('main a[href^="/image-editor/"]')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
  for (const href of new Set(links)) {
    const response = await request.get(href);
    expect(response.ok(), href).toBe(true);
  }
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`Image Editor docs and screenshots fit ${width}px in ${scheme} mode`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/image-editor");

      const figure = page.locator(".setup-screenshot");
      await figure.scrollIntoViewIfNeeded();
      const image = figure.locator("img:visible").first();
      await expect(image).toHaveAttribute("src", new RegExp(`image-editor-${scheme}\\.webp`));
      await expect
        .poll(() => image.evaluate((item: HTMLImageElement) => item.naturalWidth))
        .toBeGreaterThan(0);
      await expect(figure.getByRole("button", { name: /Expand image/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(errors).toEqual([]);
    });
  }
}
