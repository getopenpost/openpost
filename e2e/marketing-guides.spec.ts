import { expect, test } from "@playwright/test";

const guideQuestions = [
  "What are the best social media tools for solo founders?",
  "How do I turn product updates into social media posts?",
  "How do I schedule social media posts on multiple platforms?",
  "What social media schedulers can I self-host?",
  "Which social media tools have an API and MCP server?",
];

test.describe("buying guides without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("readers can discover and read every sourced answer", async ({ page, request }) => {
    await page.goto("/guides");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Choose a social media workflow that fits.",
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
      ).toContainText("No posting option has passed");
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
