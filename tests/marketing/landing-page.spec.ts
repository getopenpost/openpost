import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers.js";

test("landing product preview follows the visitor's selection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await dismissTelemetryConsent(page);
  const picker = page.getByRole("group", { name: "Explore OpenPost" });
  for (const name of [
    "Image Editor",
    "Video Editor",
    "Calendar",
    "Analytics",
    "Media",
    "Accounts",
    "Compose",
  ]) {
    const button = picker.getByRole("button", { name, exact: true });
    await button.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(picker.locator('[aria-pressed="true"]')).toHaveCount(1);
    const image = page.locator(".product-tour .preview img");
    await expect(image).toHaveAttribute(
      "alt",
      new RegExp(name === "Compose" ? "composer" : name, "i"),
    );
    await expect
      .poll(() =>
        image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth >= 2880),
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
});

test("testimonials link to their source without fictional examples", async ({ page }) => {
  await page.goto("/");
  await dismissTelemetryConsent(page);
  const stories = page.getByRole("region", { name: "First reactions." });
  await expect(stories.getByRole("link", { name: /GreenSundance/ })).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/foss/comments/1wa2075/comment/p8g2kn4/",
  );
  await expect(stories.getByRole("link", { name: /super2061/ })).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/foss/comments/1wa2075/comment/p8fnhym/",
  );
  await expect(stories.getByText("Example workflows")).toHaveCount(0);
  await expect(stories.locator("figure")).toHaveCount(2);
});

test("landing details and resources load without repeating full screenshots", async ({ page }) => {
  await page.goto("/");
  await dismissTelemetryConsent(page);
  await expect(page.locator("main video")).toHaveCount(0);
  const details = page.getByRole("region", {
    name: "Make the media right here.",
  });
  for (const image of await details.locator("img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  }
  const resources = page.getByRole("region", { name: "A few useful starting points." });
  for (const path of [
    "/tools",
    "/guides",
    "https://docs.openpo.st/guides/quickstart",
    "/platforms",
  ]) {
    await expect(resources.locator(`a[href="${path}"]`)).toBeVisible();
  }
});

test("meme screenshot does not include the blurred dialog backdrop at its sides", async ({
  page,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    const image = page.getByRole("img", {
      name: "OpenPost meme creator with editable captions and a rendered Drakeposting preview",
    });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    const edgeDifference = await image.evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.drawImage(img, 0, 0);
      const pixel = (x: number) => context.getImageData(x, 80, 1, 1).data;
      const distance = (left: Uint8ClampedArray, right: Uint8ClampedArray) =>
        Math.max(...[0, 1, 2].map((channel) => Math.abs(left[channel] - right[channel])));
      return Math.max(
        distance(pixel(2), pixel(100)),
        distance(pixel(img.naturalWidth - 3), pixel(img.naturalWidth - 101)),
      );
    });
    expect(edgeDifference).toBeLessThan(20);
  }
});

test("features navigation stays on the landing page", async ({ page }, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  }
  const navigation = page.getByRole("navigation", {
    name: testInfo.project.name.includes("mobile") ? "Mobile navigation" : "Primary navigation",
  });
  const link = navigation.getByRole("link", { name: "Features", exact: true });
  await expect(link).toHaveAttribute("href", "/#features");
  await link.click();
  await expect(page).toHaveURL(/\/#features$/);
  await expect(page.locator("#features")).toBeInViewport();
});

test("provider marks use the available icon area", async ({ page }) => {
  for (const platform of ["Pinterest", "Telegram"]) {
    await page.goto(`/platforms/${platform.toLowerCase()}`);
    const icon = page.getByRole("img", { name: platform, exact: true });
    await expect(icon).toBeVisible();
    expect(
      await icon.evaluate((svg: SVGSVGElement) => {
        const bounds = svg.getBBox();
        const viewBox = svg.viewBox.baseVal;
        return Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height);
      }),
    ).toBeGreaterThanOrEqual(0.72);
  }
});

test("footer link rows match the pointer target size", async ({ page }, testInfo) => {
  await page.goto("/");
  const productLinks = page.locator("footer ul").first().getByRole("link");
  await expect(productLinks.first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
  });
  const [first, second] = await productLinks.evaluateAll((links) =>
    links.slice(0, 2).map((link) => {
      const bounds = link.getBoundingClientRect();
      return { y: bounds.y, height: bounds.height };
    }),
  );
  const targetSize = testInfo.project.name.includes("mobile") ? 44 : 32;
  expect(first.height).toBe(targetSize);
  expect(second.y - first.y).toBe(targetSize);
});

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
    "Set repost rules",
    "See inbox support",
    "Connect your tools",
    "Explore account security",
  ]) {
    const link = features.getByRole("link", { name, exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute("href", /^https:\/\/docs\.openpo\.st\//);
  }
  for (const image of await features.locator(".visual img").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth >= 1000),
      )
      .toBe(true);
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
  ).toHaveAttribute("href", "https://docs.openpo.st/guides/automation");
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

test("landing CTAs keep shared action colors beneath the Dither texture", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Start your free trial", exact: true }).first();
    const colors = await cta.evaluate((element) => {
      const button = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement("span");
      probe.style.backgroundColor = root.getPropertyValue("--action-primary");
      document.body.append(probe);
      const sharedActionColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        backgroundColor: button.backgroundColor,
        sharedActionColor,
        texture: button.backgroundImage,
      };
    });
    expect(colors.backgroundColor).toBe(colors.sharedActionColor);
    expect(colors.texture).toContain("svg");
  }
});

for (const width of [1440, 390, 320]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`landing fits ${width}px in ${colorScheme} with reduced motion`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
      const productScreenshots = page.locator('main img[src^="/assets/screenshots/"]');
      await expect(productScreenshots).toHaveCount(8);
      for (const image of await productScreenshots.all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc))
          .toMatch(new RegExp(`-${colorScheme}\\.webp$`));
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
        await page.screenshot({
          path: testInfo.outputPath(`hero-${width}-${colorScheme}.png`),
        });
        for (const heading of [
          "studio-title",
          "features-title",
          "resources-title",
          "stories-title",
          "closing-title",
        ]) {
          await page.locator(`#${heading}`).scrollIntoViewIfNeeded();
        }
        await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`page-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    });
  }
}

test("mobile navigation lists each destination once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(navigation.getByRole("link", { name: "Features", exact: true })).toHaveAttribute(
    "href",
    "/#features",
  );
  await expect(navigation.getByRole("link", { name: "Pricing", exact: true })).toHaveCount(1);
});

test("landing content has no automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
