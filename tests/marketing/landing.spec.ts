import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers";

test.describe("landing page", () => {
  test("visitors can discover publishing, AI, memes, conversations, and developer tools", async ({
    page,
  }) => {
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const features = page.getByRole("region", {
      name: "From the first idea to the next conversation.",
    });
    for (const name of [
      "Organize your media",
      "Explore Grow",
      "Plan your publishing",
      "Explore AI writing",
      "Make a meme",
      "Explore analytics",
      "Build your first workflow",
      "Set repost rules",
      "See inbox support",
      "Connect your tools",
      "Explore account security",
    ]) {
      const link = features.getByRole("link", { name, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute("href", /^https:\/\/openpo\.st\/docs(?:\/|$)/);
    }
    for (const image of await features.locator(".visual img").filter({ visible: true }).all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
      const resolution = await image.evaluate(async (img: HTMLImageElement) => {
        const bitmap = await createImageBitmap(await (await fetch(img.currentSrc)).blob());
        const width = bitmap.width;
        bitmap.close();
        return { width, needed: img.clientWidth * window.devicePixelRatio };
      });
      expect(resolution.width).toBeGreaterThanOrEqual(resolution.needed);
    }
    for (const mark of await features.locator('img[src*="/brand/features/"]').all()) {
      await mark.scrollIntoViewIfNeeded();
      await expect(mark).toHaveAttribute("alt", "");
      await expect
        .poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
    }
    await expect(
      features.getByRole("link", { name: "Connect your tools", exact: true }),
    ).toHaveAttribute("href", "https://openpo.st/docs/automate");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("landing keeps trial terms and its tour accessible without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You build the business.");
    await expect(page.getByText("14 days free. $0 today. Card required.").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Explore OpenPost" })).toBeVisible();
    for (const button of await page
      .getByRole("group", { name: "Explore OpenPost" })
      .getByRole("button")
      .all()) {
      await expect(button).toBeDisabled();
    }
    await expect(page.getByRole("link", { name: "Start your free trial" }).first()).toHaveAttribute(
      "href",
      /app\.openpo\.st\/register\?plan=founder/,
    );
    await expect(
      page.getByRole("link", { name: "Watch the product tour", exact: true }),
    ).toHaveAttribute("href", /youtube\.com\/watch/);
    await page.locator("summary").filter({ hasText: "How does the free trial work?" }).click();
    await expect(
      page.getByRole("region", { name: "A few questions." }).locator("details[open]"),
    ).toContainText("14");
    await context.close();
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`landing fits 320px in ${colorScheme} with reduced motion`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      const productScreenshots = page
        .locator('main img[src^="/assets/screenshots/"]')
        .filter({ visible: true });
      await expect(productScreenshots).toHaveCount(8);
      for (const image of await productScreenshots.all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc))
          .toMatch(new RegExp(`-${colorScheme}(?:-(?:768|1536))?\\.webp$`));
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(page.getByRole("group", { name: "Explore OpenPost" })).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator("img")
            .evaluateAll((images) =>
              images
                .filter((image) => image.loading !== "lazy")
                .every((image) => image.complete && image.naturalWidth > 0),
            ),
        )
        .toBe(true);
      if (process.env.OPENPOST_CAPTURE_LANDING === "1") {
        await page.evaluate(() => document.fonts.ready);
        for (const heading of [
          "studio-title",
          "features-title",
          "resources-title",
          "stories-title",
        ]) {
          await page.locator(`#${heading}`).scrollIntoViewIfNeeded();
        }
        await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
      }
    });
  }

  test("landing content has no automated accessibility violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("brand contrast", () => {
  test("the first theme switch waits for hydration", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "script") await scriptsReady;
      await route.continue();
    });
    try {
      await page.goto("/", { waitUntil: "commit" });
      const switchTheme = page.locator("header.marketing-nav").getByRole("button", {
        name: "Use dark theme",
        exact: true,
      });
      await expect(switchTheme).toBeVisible();
      await expect(switchTheme).toBeDisabled();
      const switching = switchTheme.click();
      releaseScripts();
      await switching;
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    } finally {
      releaseScripts();
    }
  });
});
