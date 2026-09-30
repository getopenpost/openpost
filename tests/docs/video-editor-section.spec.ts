import { expect, test } from "@playwright/test";

const pages = [
  ["/video-editor", "Video Editor"],
  ["/video-editor/start", "Start a project"],
  ["/video-editor/timeline", "Edit on the timeline"],
  ["/video-editor/color-motion-and-effects", "Color, motion, and effects"],
  ["/video-editor/transcript-and-audio", "Transcript, captions, and audio"],
  ["/video-editor/export-and-publish", "Export and publish"],
  ["/video-editor/quick-cut-and-recorder", "Quick Cut and Recorder"],
  ["/video-editor/browser-and-recovery", "Browser support and recovery"],
] as const;

test("every Video Editor guide renders and its section links resolve", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(`/docs${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  await page.goto("/docs/video-editor");
  const links = await page
    .locator('main a[href^="/docs/video-editor/"]')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
  for (const href of new Set(links)) {
    const response = await request.get(href);
    expect(response.ok(), href).toBe(true);
  }
  expect(errors).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`Video Editor guides fit ${width}px in ${scheme} mode`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const [route, heading] of pages) {
        await page.goto(`/docs${route}`);
        await expect(
          page.getByRole("heading", { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(width);
      }
      expect(errors).toEqual([]);
    });
  }
}
