import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

test.describe("marketing guides", () => {
  const guideQuestions = [
    "What are the best social media tools for solo founders?",
    "How do I turn product updates into social media posts?",
    "How do I schedule social media posts on multiple platforms?",
    "OpenPost vs Buffer: which fits your content workflow?",
    "OpenPost vs Postiz: which fits your content workflow?",
    "OpenPost vs Metricool: creation or reporting first?",
    "OpenPost vs Hootsuite: founder workflow or social team?",
    "OpenPost vs Photoshop: social images or deep photo editing?",
    "OpenPost vs DaVinci Resolve: browser clips or a full post studio?",
    "OpenPost vs Premiere Pro: quick social edits or professional production?",
  ];

  test.describe("buying guides without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("readers can discover and read every sourced answer", async ({ page, request }) => {
      await page.goto("/guides");
      await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
        "Make more of your work. Find a better way.",
      );
      await expect(
        page.getByRole("searchbox", { name: "Search guides and comparisons" }),
      ).toBeDisabled();
      for (const filter of await page
        .getByRole("group", { name: "Filter resources by category" })
        .getByRole("button")
        .all()) {
        await expect(filter).toBeDisabled();
      }
      const sitemap = await request.get("/sitemap.xml");
      const sitemapText = await sitemap.text();
      for (const question of guideQuestions) {
        await page.goto("/guides");
        await page
          .getByRole("link")
          .filter({
            has: page.getByRole("heading", {
              name: question.startsWith("OpenPost vs ") ? question.split(":")[0] : question,
              exact: true,
            }),
          })
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(question);
        await expect(page).toHaveTitle(`${question} - OpenPost`);
        const creative = /Photoshop|DaVinci Resolve|Premiere Pro/.test(question);
        if (creative) {
          await expect(
            page.getByRole("heading", { name: "What is free in OpenPost" }),
          ).toBeVisible();
          await expect(page.getByRole("table", { name: "OpenPost Hosted plans" })).toHaveCount(0);
        } else {
          await expect(
            page.getByRole("complementary", { name: "OpenPost Hosted readiness" }),
          ).toContainText("Check provider requirements and live-account readiness");
        }
        await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
        const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
        expect(canonical).toBe(`https://openpo.st${new URL(page.url()).pathname}`);
        expect(sitemapText).toContain(canonical);
        const markdownURL = `${canonical}.md`;
        await expect(
          page.locator(`link[rel="alternate"][type="text/markdown"][href="${markdownURL}"]`),
        ).toHaveCount(1);
        const markdown = await request.get(new URL(markdownURL).pathname);
        expect(markdown.ok()).toBe(true);
        expect(await markdown.text()).toContain(question);
      }
    });
  });

  test("readers can filter comparisons, recover an empty search, and open a free editor", async ({
    page,
  }) => {
    await page.goto("/comparisons");
    await dismissTelemetryConsent(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Compare your tools. Choose for the job.",
    );
    for (const control of await page
      .getByRole("group", { name: "Filter resources by category" })
      .getByRole("button")
      .all()) {
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Images", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "resource" })).toHaveText("1 resource");
    const photoshop = page
      .getByRole("link")
      .filter({ has: page.getByRole("heading", { name: "OpenPost vs Photoshop", exact: true }) });
    await expect(photoshop).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search guides and comparisons" })
      .fill("no matching tool");
    await expect(
      page.getByRole("heading", { name: "No resources match that search." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show all resources" }).click();
    await expect(page.getByRole("status").filter({ hasText: "resources" })).toHaveText(
      "7 resources",
    );
    await photoshop.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/guides\/openpost-vs-photoshop$/);
    for (const link of await page
      .getByRole("complementary", { name: "Reading tools" })
      .getByRole("link")
      .all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByRole("complementary", { name: "Reading tools" })
      .getByRole("link", { name: "Try the free Image Editor" })
      .click();
    await expect(page).toHaveURL(/\/tools\/social-media-image-editor$/);
    await page.goto("/guides");
    await page.getByRole("button", { name: "Content guides", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "resources" })).toHaveText(
      "3 resources",
    );
  });
});

test.describe("extensions", () => {
  test("old extension links redirect to Feed Limiter", async ({ request }) => {
    for (const [oldPath, destination] of [
      ["/tools/x-timeline-blocker", "/tools/feed-limiter"],
      ["/tools/x-timeline-blocker/", "/tools/feed-limiter"],
      ["/tools/x-timeline-blocker.md", "/tools/feed-limiter.md"],
    ]) {
      const response = await request.get(`${oldPath}?source=old-link`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(301);
      const location = new URL(response.headers().location, response.url());
      expect(location.pathname).toBe(destination);
      expect(location.searchParams.get("source")).toBe("old-link");
    }
  });
});
