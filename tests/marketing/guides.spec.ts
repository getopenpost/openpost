import { expect, test, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

  test(`comparison tables remain readable at 320px in light`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
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
      await expect(tables.first().locator("tbody .cell-label").first()).toBeVisible();
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
        for (const [index, table] of (await tables.all()).entries()) {
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
});

test.describe("extensions", () => {
  test("extensions are discoverable and their install pages fit a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tools");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Extensions", exact: true }).click();
    const extensions = page.locator("#extensions");
    await expect(extensions.getByRole("link", { name: /YouTube Localizer/ })).toBeVisible();
    await expect(extensions.getByRole("link", { name: /Feed Limiter/ })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search free tools" }).fill("Localizer");
    await expect(extensions.getByRole("link")).toHaveCount(1);
    await extensions.getByRole("link", { name: /YouTube Localizer/ }).click();
    await expect(
      page.getByRole("heading", { name: "YouTube Localizer", exact: true }),
    ).toBeVisible();
    for (const [route, storeURL] of [
      [
        "/tools/youtube-localizer",
        "https://chromewebstore.google.com/detail/gblknofeccibdadogbplgcokneofgcdo",
      ],
      [
        "/tools/feed-limiter",
        "https://chromewebstore.google.com/detail/ckiajdbokbecejpammackpihhojjdbke",
      ],
    ]) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("figure img").first()).toBeVisible();
      const settings = page.getByRole("region", {
        name: "Extension settings screenshots",
      });
      await expect(settings.getByRole("img")).toHaveCount(2);
      for (const image of await page.locator("figure img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect(image).toBeVisible();
        await expect
          .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      }
      await page.getByRole("link", { name: "Privacy policy", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Privacy policy", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("heading", {
          name: "Your data and deletion",
          exact: true,
        }),
      ).toBeVisible();
      const install = page.getByRole("link", { name: "Add to Chrome", exact: true });
      await expect(install).toBeVisible();
      await expect(install).toHaveAttribute("href", storeURL);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    }
  });

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

test.describe("youtube branding", () => {
  async function expectYouTubeMark(artwork: Locator) {
    await expect.soft(artwork).toBeVisible();
    if ((await artwork.count()) === 0) return;
    await artwork.scrollIntoViewIfNeeded();
    const geometry = await artwork.evaluate(async (node: HTMLImageElement) => {
      await node.decode();
      const box = node.getBoundingClientRect();
      const parent = node.parentElement!.getBoundingClientRect();
      const scale = 4;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(box.width * scale);
      canvas.height = Math.ceil(box.height * scale);
      const context = canvas.getContext("2d")!;
      context.drawImage(node, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let first = canvas.height;
      let last = -1;
      let left = canvas.width;
      let right = -1;
      let red = 0;
      let white = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (pixels[i + 3] < 128) continue;
          first = Math.min(first, y);
          last = Math.max(last, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
          if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 51) red++;
          if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
        }
      }
      return {
        paintedHeight: (last - first + 1) / scale,
        paintedAspect: (right - left + 1) / (last - first + 1),
        clearLeft: left / scale,
        clearRight: (canvas.width - right - 1) / scale,
        red,
        white,
        width: box.width,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        parentLeft: parent.left,
        parentRight: parent.right,
        parentTop: parent.top,
        parentBottom: parent.bottom,
      };
    });
    expect(geometry.paintedHeight).toBeGreaterThanOrEqual(20);
    expect(geometry.paintedHeight).toBeLessThanOrEqual(28);
    expect(geometry.width).toBeLessThanOrEqual(56);
    expect(geometry.height).toBeLessThanOrEqual(48);
    expect(geometry.paintedAspect).toBeGreaterThan(1.4);
    expect(geometry.paintedAspect).toBeLessThan(1.45);
    expect(geometry.clearLeft).toBeGreaterThanOrEqual(9);
    expect(geometry.clearRight).toBeGreaterThanOrEqual(9);
    expect(geometry.red).toBeGreaterThan(1000);
    expect(geometry.white).toBeGreaterThan(100);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft);
    expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.parentTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.parentBottom);
  }

  test(`YouTube marketing branding fits 320px in light`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const resources = page.locator('a.platforms[href="/platforms"]');
    await expect.soft(resources.locator(".platform-art img")).toHaveCount(5);
    await expectYouTubeMark(resources.locator(".youtube-brand"));

    await page.goto("/platforms");
    const card = page.locator('a.channel[href="/platforms/youtube"]');
    await expectYouTubeMark(card.locator(".youtube-brand"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test(`Channels menu stays reachable at 700px height in light`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Channels", exact: true }).click();
    const panel = page.locator(".platform-menu");
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect.soft(bounds!.y).toBeGreaterThanOrEqual(0);
    expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
    const lastChannel = panel.locator('a[href^="/platforms/"]').last();
    await lastChannel.scrollIntoViewIfNeeded();
    await expect.soft(lastChannel).toBeInViewport({ ratio: 1 });
    expect.soft(await panel.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  });
});
