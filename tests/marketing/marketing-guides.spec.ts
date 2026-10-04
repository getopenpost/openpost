import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers";

const guideQuestions = [
  "What are the best social media tools for solo founders?",
  "How do I turn product updates into social media posts?",
  "How do I schedule social media posts on multiple platforms?",
  "OpenPost vs Buffer: which fits your content workflow?",
  "OpenPost vs Postiz: which fits your content workflow?",
];

test.describe("buying guides without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("readers can discover and read every sourced answer", async ({ page, request }) => {
    await page.goto("/guides");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Make more of what you make.",
    );
    const sitemap = await request.get("/sitemap.xml");
    const sitemapText = await sitemap.text();
    for (const question of guideQuestions) {
      await page.goto("/guides");
      await page
        .getByRole("link")
        .filter({
          has: page.getByRole("heading", { name: question, exact: true }),
        })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(question);
      await expect(page).toHaveTitle(`${question} - OpenPost`);
      await expect(
        page.getByRole("complementary", { name: "OpenPost Hosted readiness" }),
      ).toContainText("Check provider requirements and live-account readiness");
      await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical).toBe(`https://openpo.st${new URL(page.url()).pathname}`);
      expect(sitemapText).toContain(canonical);
      const markdownPath = await page
        .locator('link[rel="alternate"][type="text/markdown"]')
        .getAttribute("href");
      expect(markdownPath).toBeTruthy();
      const markdown = await request.get(new URL(markdownPath!).pathname);
      expect(markdown.ok()).toBe(true);
      expect(await markdown.text()).toContain(question);
    }
  });
});

for (const width of [1440, 390, 320]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`comparison tables remain readable at ${width}px in ${colorScheme} @desktop`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const competitor of ["buffer", "postiz"]) {
        await page.goto(`/guides/openpost-vs-${competitor}`);
        await dismissTelemetryConsent(page);
        const tables = page.getByRole("table");
        await expect(tables).toHaveCount(2);
        await expect(page.locator("article time")).toHaveText("4 October 2026");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await expect(
          page.getByRole("heading", {
            name: `When ${competitor === "buffer" ? "Buffer" : "Postiz"} is the better fit`,
          }),
        ).toBeVisible();
        if (width < 640) {
          await expect(tables.first().locator("tbody .cell-label").first()).toBeVisible();
        }
        await expect(page.getByRole("table", { name: "OpenPost Hosted plans" })).toContainText(
          "Limits per workspace",
        );
        const accessibility = await new AxeBuilder({ page }).include("article").analyze();
        expect(accessibility.violations).toEqual([]);
        if (process.env.OPENPOST_MARKETING_CAPTURE === "1") {
          await page.screenshot({
            path: testInfo.outputPath(`${competitor}-intro.png`),
            animations: "disabled",
          });
          await page.screenshot({
            path: testInfo.outputPath(`${competitor}-page.png`),
            fullPage: true,
            animations: "disabled",
          });
          for (const [index, table] of (await tables.all()).entries()) {
            await table.screenshot({
              path: testInfo.outputPath(`${competitor}-plans-${index}.png`),
              animations: "disabled",
              style: ".marketing-nav { visibility: hidden; }",
            });
          }
        }
        const back = page.getByRole("link", { name: "All publishing guides" });
        await back.focus();
        await expect(back).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/guides$/);
        const comparison = page.getByRole("link").filter({
          has: page.getByRole("heading", {
            name: `OpenPost vs ${competitor === "buffer" ? "Buffer" : "Postiz"}: which fits your content workflow?`,
          }),
        });
        await comparison.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`/guides/openpost-vs-${competitor}$`));
      }
      expect(errors).toEqual([]);
    });
  }
}
