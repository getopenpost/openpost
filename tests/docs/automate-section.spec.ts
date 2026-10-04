import { expect, test } from "@playwright/test";

const pages = [
  ["/automate", "Automate"],
  ["/automate/sdk", "TypeScript SDK"],
  ["/automate/sdk/publications", "Create and publish posts with the SDK"],
  ["/automate/sdk/reliability", "Handle SDK jobs, conflicts, and errors"],
  ["/automate/api", "HTTP API"],
  ["/automate/api/publications", "Create and publish posts over HTTP"],
  ["/automate/api/media", "Media uploads"],
  ["/automate/api/reliability", "Handle API revisions, retries, and jobs"],
  ["/automate/cli", "Command-line interface"],
  ["/automate/cli/publishing", "Create and publish content"],
  ["/automate/cli/scripts-and-ci", "Scripts and CI"],
  ["/automate/cli/inspect-and-recover", "Inspect and recover"],
  ["/automate/n8n", "n8n workflows"],
  ["/automate/n8n/build-a-workflow", "Build a publishing workflow"],
  ["/automate/n8n/reliability", "Handle n8n retries and failures"],
] as const;

test("Automate groups are always-visible sidebar sections", async ({ page }) => {
  await page.goto("/docs/automate/sdk");

  const sidebar = page.locator("#nd-sidebar");
  for (const section of ["TypeScript SDK", "HTTP API", "Command-line interface", "n8n workflows"]) {
    await expect(sidebar.getByRole("link", { name: section, exact: true }).first()).toBeVisible();
    await expect(sidebar.getByRole("button", { name: section, exact: true })).toHaveCount(0);
  }

  await expect(sidebar.getByRole("link", { name: "Build a publishing workflow" })).toBeVisible();
});

test("every Automate guide renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(`/docs${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  expect(errors).toEqual([]);
});

test("Automate guide links resolve", async ({ page, request }) => {
  for (const [route] of pages) {
    await page.goto(`/docs${route}`);
    const links = await page
      .locator('main a[href^="/docs/automate/"], main a[href^="/docs/api-reference"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
    for (const href of new Set(links)) {
      const response = await request.get(href);
      expect(response.ok(), `${route} -> ${href}`).toBe(true);
    }
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`Automate guides fit ${width}px in ${scheme} mode`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

      for (const route of [
        "/automate/sdk/publications",
        "/automate/api/publications",
        "/automate/api/media",
        "/automate/cli/publishing",
        "/automate/n8n/build-a-workflow",
      ]) {
        await page.goto(`/docs${route}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }

      expect(errors).toEqual([]);
    });
  }
}
