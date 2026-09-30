import { expect, test } from "@playwright/test";

const routes = [
  ["", "Workflows"],
  ["/first-workflow", "Build your first workflow"],
  ["/editor", "Use the canvas"],
  ["/triggers", "Choose a trigger"],
  ["/variables", "Pass data between steps"],
  ["/ai", "Use AI"],
  ["/connections", "Connections and HTTP requests"],
  ["/testing", "Preview and test"],
  ["/review-and-schedule", "Review and schedule posts"],
  ["/runs", "Manage runs"],
  ["/reposts", "Reposts and first comments"],
  ["/examples", "Workflow examples"],
  ["/examples/feed-digest", "Prepare a weekly feed digest"],
  ["/examples/relevant-releases", "Share only relevant releases"],
  ["/examples/api-to-post", "Turn an API response into a post"],
] as const;

test("workflow guides are reachable from their own section and sidebar", async ({
  page,
  request,
}) => {
  await page.goto("/docs/");
  await page
    .getByRole("navigation", { name: "Documentation sections" })
    .getByRole("link", { name: "Workflows", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Workflows", exact: true }),
  ).toBeVisible();
  const sidebar = page.locator("#nd-sidebar");
  await expect(sidebar.locator('a[href="/docs/workflows/examples"]')).toHaveCount(1);
  const checked = new Set<string>();
  for (const [suffix, heading] of routes.slice(1)) {
    await sidebar
      .getByRole("link", {
        name: suffix === "/examples" ? "Choose an example" : heading,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/docs/workflows${suffix}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    const links = await page
      .locator('#nd-page a[href^="/docs/"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")!));
    for (const href of links) {
      if (checked.has(href)) continue;
      checked.add(href);
      expect((await request.get(href)).ok(), href).toBe(true);
    }
  }
});

test("old workflow HTML and Markdown URLs reach the new guides", async ({ request }) => {
  for (const [oldPath, target] of [
    ["workflows", "/workflows"],
    ["workflows/", "/workflows"],
    ["workflows.md", "/workflows/index.md"],
    ["workflow-examples", "/workflows/examples"],
    ["workflow-examples/", "/workflows/examples"],
    ["workflow-examples.md", "/workflows/examples/index.md"],
  ]) {
    const response = await request.get(`/docs/automate/${oldPath}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe(`/docs${target}`);
    expect((await request.get(`/docs${target}`)).ok()).toBe(true);
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`workflow guides fit ${width}px in ${scheme} mode`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      for (const [suffix, heading] of routes) {
        await page.goto(`/docs/workflows${suffix}`);
        await expect(
          page.getByRole("heading", { level: 1, name: heading, exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      expect(errors).toEqual([]);
    });
  }
}
