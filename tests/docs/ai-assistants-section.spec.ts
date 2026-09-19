import { expect, test } from "@playwright/test";

const pages = [
  ["/mcp", "AI assistants"],
  ["/mcp/choose-an-agent-connection", "Choose an agent connection"],
  ["/mcp/mcp-guide", "Connect with MCP"],
  ["/mcp/mcp-guide/endpoints-and-tools", "Endpoints and tools"],
  ["/mcp/mcp-guide/permissions-and-safety", "Permissions and safety"],
  ["/mcp/mcp-guide/media", "Media and local files"],
  ["/mcp/mcp-guide/self-hosted-and-local", "Self-hosted and local connections"],
  ["/mcp/mcp-guide/use-cases", "MCP use cases"],
  ["/mcp/skills", "OpenPost skills"],
  ["/mcp/skills/install", "Install the OpenPost skill"],
  ["/mcp/skills/openpost-cli", "How the CLI skill works"],
  ["/mcp/skills/use-cases", "CLI skill use cases"],
] as const;

test("every AI assistant overview, MCP, and skill guide renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  expect(errors).toEqual([]);
});

test("the AI assistant overview reaches every focused guide", async ({ page, request }) => {
  await page.goto("/mcp");
  const sectionLinks = [
    "/mcp/choose-an-agent-connection",
    "/mcp/mcp-guide",
    "/mcp/skills",
    "/automate/cli",
    "/automate/sdk",
    "/automate/api",
  ];

  for (const href of sectionLinks) {
    await expect(page.locator(`main a[href="${href}"]`).first()).toBeVisible();
    const response = await request.get(href);
    expect(response.ok(), href).toBe(true);
  }
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`AI assistant guides fit ${width}px in ${scheme} mode`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

      for (const route of [
        "/mcp",
        "/mcp/choose-an-agent-connection",
        "/mcp/mcp-guide/endpoints-and-tools",
        "/mcp/skills/install",
      ]) {
        await page.goto(route);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(width);
      }

      expect(errors).toEqual([]);
    });
  }
}
