import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers";

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
        await expect(page.getByRole("heading", { name: "What is free in OpenPost" })).toBeVisible();
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
  await expect(page.getByRole("status").filter({ hasText: "resources" })).toHaveText("7 resources");
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
  await expect(page.getByRole("status").filter({ hasText: "resources" })).toHaveText("3 resources");
});

for (const width of [1440, 390, 320]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`comparison tables remain readable at ${width}px in ${colorScheme} @desktop`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const directory of ["guides", "comparisons"]) {
        await page.goto("/" + directory);
        await dismissTelemetryConsent(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        expect(
          (await new AxeBuilder({ page }).include(".guide-directory").analyze()).violations,
        ).toEqual([]);
        if (process.env.OPENPOST_MARKETING_CAPTURE === "1") {
          await page.screenshot({
            path: testInfo.outputPath(directory + "-directory.png"),
            animations: "disabled",
          });
          await page.locator(".guide-directory").screenshot({
            path: testInfo.outputPath(directory + "-full.png"),
            animations: "disabled",
            style: ".marketing-nav {visibility:hidden;}",
          });
        }
      }
      for (const [competitor, name] of [
        ["buffer", "Buffer"],
        ["postiz", "Postiz"],
        ["metricool", "Metricool"],
        ["hootsuite", "Hootsuite"],
        ["photoshop", "Photoshop"],
        ["davinci-resolve", "DaVinci Resolve"],
        ["premiere-pro", "Premiere Pro"],
      ]) {
        await page.goto(`/guides/openpost-vs-${competitor}`);
        await dismissTelemetryConsent(page);
        const tables = page.getByRole("table");
        const creative = ["photoshop", "davinci-resolve", "premiere-pro"].includes(competitor);
        await expect(tables).toHaveCount(creative || competitor === "hootsuite" ? 1 : 2);
        const logo = page.locator(".guide-hero").getByRole("img", { name, exact: true });
        await expect
          .poll(() =>
            logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        await expect(page.locator("article time")).toHaveText("4 October 2026");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await expect(
          page.getByRole("heading", {
            name: `When ${name} is the better fit`,
          }),
        ).toBeVisible();
        if (width < 640) {
          await expect(tables.first().locator("tbody .cell-label").first()).toBeVisible();
        }
        if (creative) {
          await expect(page.getByRole("table", { name: "OpenPost Hosted plans" })).toHaveCount(0);
          await expect(tables.first()).toContainText("$0");
        } else {
          await expect(page.getByRole("table", { name: "OpenPost Hosted plans" })).toContainText(
            "Limits per workspace",
          );
        }
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
        const back = page.getByRole("link", { name: "All comparisons", exact: true });
        await back.focus();
        await expect(back).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/comparisons$/);
        const comparison = page.getByRole("link").filter({
          has: page.getByRole("heading", {
            name: `OpenPost vs ${name}`,
            exact: true,
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
