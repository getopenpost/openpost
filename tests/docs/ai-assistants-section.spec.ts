import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const pages = [
  ["/mcp", "AI assistants"],
  ["/mcp/chat-assistants", "Chat assistants"],
  ["/mcp/coding-assistants", "Coding assistants"],
  ["/mcp/mcp-guide", "Connect with MCP"],
  ["/mcp/grok-bot", "Create a Grok Bot for OpenPost"],
  ["/mcp/mcp-guide/media", "Upload media"],
  ["/mcp/mcp-guide/use-cases", "Tasks and troubleshooting"],
  ["/mcp/skills", "Install and use the OpenPost skill"],
] as const;

test("Grok Bot instructions stay readable on phones and copy without visual wrapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedText = text;
        },
      },
    });
  });
  await page.goto("/docs/mcp/grok-bot");
  const instructions = page.locator("pre").filter({ hasText: "Purpose" });
  expect(
    await instructions.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await instructions.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(320);
  const source = readFileSync(
    new URL("../../apps/docs/content/docs/mcp/grok-bot.mdx", import.meta.url),
    "utf8",
  );
  const expected = source.split("```text\nPurpose\n")[1].split("\n```")[0];
  await instructions
    .locator("xpath=ancestor::figure")
    .getByRole("button", { name: "Copy Text", exact: true })
    .click();
  await expect
    .poll(() => page.locator("html").getAttribute("data-copied-text"))
    .toBe(`Purpose\n${expected}`);
});

test("every AI assistant overview, MCP, and skill guide renders", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const [route, heading] of pages) {
    await page.goto(`/docs${route}`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator("#nd-page")).not.toContainText("Page not found");
  }

  expect(errors).toEqual([]);
});

test("the AI assistant overview reaches every focused guide", async ({ page, request }) => {
  await page.goto("/docs/mcp");
  const sectionLinks = [
    "/mcp/chatgpt",
    "/mcp/codex",
    "/mcp/mcp-guide",
    "/mcp/skills",
    "/automate/cli",
    "/automate/sdk",
    "/automate/api",
  ];

  for (const href of sectionLinks) {
    const docsHref = `/docs${href}`;
    await expect(page.locator(`main a[href="${docsHref}"]`).first()).toBeVisible();
    const response = await request.get(docsHref);
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

      for (const route of ["/mcp", "/mcp/chat-assistants", "/mcp/mcp-guide", "/mcp/skills"]) {
        await page.goto(`/docs${route}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(width);
      }

      expect(errors).toEqual([]);
    });
  }
}
