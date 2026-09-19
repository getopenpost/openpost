import { expect, test } from "@playwright/test";

const pages = [
  ["/automate", "Automate"],
  ["/automate/sdk", "TypeScript SDK"],
  ["/automate/sdk/setup", "Install and connect"],
  ["/automate/sdk/publications", "Publications and Renditions"],
  ["/automate/sdk/media", "Upload media"],
  ["/automate/sdk/reliability", "Jobs, conflicts, and errors"],
  ["/automate/api", "HTTP API"],
  ["/automate/api/authentication", "Authentication and workspaces"],
  ["/automate/api/publications", "Publications and Renditions"],
  ["/automate/api/media", "Media uploads"],
  ["/automate/api/reliability", "Revisions, retries, and jobs"],
  ["/automate/cli", "Command-line interface"],
  ["/automate/cli/setup", "Install and sign in"],
  ["/automate/cli/publishing", "Create and publish content"],
  ["/automate/cli/scripts-and-ci", "Scripts and CI"],
  ["/automate/cli/inspect-and-recover", "Inspect and recover"],
  ["/automate/n8n", "n8n workflows"],
  ["/automate/n8n/setup", "Install and connect"],
  ["/automate/n8n/build-a-workflow", "Build a publishing workflow"],
  ["/automate/n8n/media", "Upload binary data"],
  ["/automate/n8n/reliability", "Retries and failures"],
] as const;

test("Automate groups are always-visible sidebar sections", async ({ page }) => {
  await page.goto("/automate/sdk");

  const sidebar = page.locator("#nd-sidebar");
  for (const section of ["TypeScript SDK", "HTTP API", "Command-line interface", "n8n workflows"]) {
    await expect(sidebar.getByText(section, { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: section, exact: true })).toHaveCount(0);
  }

  await expect(sidebar.getByRole("link", { name: "Install and connect", exact: true })).toHaveCount(
    2,
  );
  await expect(sidebar.getByRole("link", { name: "Authentication and workspaces" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Install and sign in" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Build a publishing workflow" })).toBeVisible();
});

test("every Automate guide renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  expect(errors).toEqual([]);
});

test("Automate guide links resolve", async ({ page, request }) => {
  for (const [route] of pages) {
    await page.goto(route);
    const links = await page
      .locator('main a[href^="/automate/"], main a[href^="/api-reference"]')
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
        await page.goto(route);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }

      expect(errors).toEqual([]);
    });
  }
}
