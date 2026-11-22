import { expect, test, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers";
import { mkdir } from "node:fs/promises";
import { expectBalancedDitherButton } from "../helpers/dither-button";

test.describe("landing page", () => {
  test("landing keeps hydration hints off the first-paint request", async ({ request }) => {
    const response = await request.get("/");
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).not.toContain('rel="modulepreload"');
    expect(html).toContain("main-light-768.webp 768w");
    expect(html).toContain("main-dark-768.webp 768w");
  });

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
      "Workflows",
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
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth >= img.clientWidth,
          ),
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

  test("landing details and resources load without repeating full screenshots", async ({
    page,
  }) => {
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
      "https://openpo.st/docs/guides/quickstart",
      "/platforms",
    ]) {
      await expect(resources.locator(`a[href="${path}"]`)).toBeVisible();
    }
  });

  test("meme screenshot does not include the blurred dialog backdrop at its sides", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const image = page.getByRole("img", {
      name: "OpenPost meme creator with editable captions and a rendered Drakeposting preview",
    });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    const edgeDifference = await image.evaluate(async (img: HTMLImageElement) => {
      const bitmap = await createImageBitmap(await (await fetch(img.currentSrc)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const sourceWidth = Number(img.getAttribute("width"));
      const scale = canvas.width / sourceWidth;
      const pixel = (x: number) =>
        context.getImageData(
          Math.min(canvas.width - 1, Math.max(1, Math.round(x * scale))),
          Math.round(80 * scale),
          1,
          1,
        ).data;
      const distance = (left: Uint8ClampedArray, right: Uint8ClampedArray) =>
        Math.max(...[0, 1, 2].map((channel) => Math.abs(left[channel] - right[channel])));
      return Math.max(
        distance(pixel(2), pixel(100)),
        distance(pixel(sourceWidth - 3), pixel(sourceWidth - 101)),
      );
    });
    expect(edgeDifference).toBeLessThan(20);
  });

  test("features navigation stays on the landing page @mobile", async ({ page }, testInfo) => {
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
    await page.goto(`/platforms/${"Pinterest".toLowerCase()}`);
    const icon = page.locator("svg").filter({
      has: page.locator("title", { hasText: new RegExp(`^Pinterest$`) }),
    });
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(
      await icon.evaluate((svg: SVGSVGElement) => {
        const bounds = svg.getBBox();
        const viewBox = svg.viewBox.baseVal;
        return Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height);
      }),
    ).toBeGreaterThanOrEqual(0.72);
  });

  test("footer link rows match the pointer target size @mobile", async ({ page }, testInfo) => {
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

  test("landing CTAs keep shared action colors beneath the Dither texture", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      const cta = page.getByRole("link", { name: "Start your free trial", exact: true }).first();
      await expect
        .poll(() => cta.evaluate((element) => getComputedStyle(element, "::before").maskImage))
        .toContain("svg");
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
        };
      });
      expect(colors.backgroundColor).toBe(colors.sharedActionColor);
    }
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

  test("mobile navigation lists each destination once @mobile", async ({ page }) => {
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
});

test.describe("hero accent reflow", () => {
  async function readAnnotationGeometry(annotation: Locator) {
    return annotation.evaluate((node) => {
      const svg = node as SVGSVGElement;
      const target = svg.previousElementSibling!;
      const rect = target.getBoundingClientRect();
      const bounds = svg.getBBox();
      const matrix = svg.getScreenCTM()!;
      const start = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
      const end = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(
        matrix,
      );
      return {
        text: target.textContent,
        target: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        circle: { left: start.x, top: start.y, right: end.x, bottom: end.y },
      };
    });
  }

  test("decorative circles follow settled responsive heading geometry", async ({ page }) => {
    test.setTimeout(90_000);
    // Exercise the narrow end of the decorative ellipse's random radius variation.
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    for (const route of [
      "/tools",
      "/tools/logo-maker",
      "/tools/multi-platform-character-counter",
    ]) {
      await page.setViewportSize({ width: 1280, height: 844 });
      await page.goto(route);
      await dismissTelemetryConsent(page);
      await page.evaluate(() => document.fonts.ready);
      const annotations = page.locator("svg.rough-annotation");
      // One path per sketch iteration; a redraw that duplicates the annotation adds more.
      await expect(annotations.first().locator("path")).toHaveCount(2);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => document.fonts.ready);
        for (let index = 0; index < (await annotations.count()); index++) {
          const annotation = annotations.nth(index);
          await annotation.evaluate((node) =>
            node.previousElementSibling!.scrollIntoView({ block: "center" }),
          );
          await expect
            .poll(async () => {
              const { circle, target } = await readAnnotationGeometry(annotation);
              return {
                centered:
                  Math.max(
                    Math.abs((circle.left + circle.right - target.left - target.right) / 2),
                    Math.abs((circle.top + circle.bottom - target.top - target.bottom) / 2),
                  ) < 10,
                boundedWidth: circle.right - circle.left <= (target.right - target.left) * 1.3 + 18,
                boundedHeight:
                  circle.bottom - circle.top <= (target.bottom - target.top) * 1.3 + 10,
                left: circle.left <= target.left + 10,
                right: circle.right >= target.right - 10,
                top: circle.top <= target.top + 10,
                bottom: circle.bottom >= target.bottom - 10,
              };
            })
            .toEqual({
              centered: true,
              boundedWidth: true,
              boundedHeight: true,
              left: true,
              right: true,
              top: true,
              bottom: true,
            });
          const geometry = await readAnnotationGeometry(annotation);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
    }
  });
});

test.describe("product motion", () => {
  test("repeat visits do not accumulate screenshot click listeners", async ({ page }) => {
    const session = await page.context().newCDPSession(page);
    const listenerCount = async () => {
      const document = await session.send("Runtime.evaluate", {
        expression: "document",
      });
      const { listeners } = await session.send("DOMDebugger.getEventListeners", {
        objectId: document.result.objectId!,
      });
      return listeners.filter((listener) => listener.type === "click").length;
    };
    await page.goto("/");
    await dismissTelemetryConsent(page);
    await expect(page.locator(".rough-annotation")).toHaveCount(2);
    const originalListeners = await listenerCount();
    for (let visit = 0; visit < 3; visit++) {
      await page.getByRole("link", { name: "Pricing", exact: true }).first().click();
      await expect(page).toHaveURL(/\/pricing$/);
      await page.getByRole("link", { name: "OpenPost home", exact: true }).first().click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator(".rough-annotation")).toHaveCount(2);
      expect(await listenerCount()).toBe(originalListeners);
    }
    await page.getByRole("button", { name: "Video Editor", exact: true }).click();
    await page.getByRole("link", { name: "Enlarge Video Editor screenshot" }).press("Enter");
    await expect(page.getByRole("button", { name: "Close Video Editor screenshot" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".medium-zoom-image--opened")).toHaveCount(0);
    await session.detach();
  });

  test("screenshot pointer clicks preserve new-tab links and remember an early Escape", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Image Editor", exact: true }).click();
    const trigger = page.getByRole("link", {
      name: "Enlarge Image Editor screenshot",
    });
    const newPage = context.waitForEvent("page");
    await trigger.locator("img").click({ modifiers: ["ControlOrMeta"] });
    const imageTab = await newPage;
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Close Image Editor screenshot" })).toHaveCount(
      0,
    );
    await imageTab.close();
    await trigger.locator("img").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".medium-zoom-image--opened")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test(`product screenshots support keyboard zoom at 1440px in light`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({
      colorScheme: "light",
      reducedMotion: "no-preference",
    });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    await expect(page.locator(".rough-annotation")).toHaveCount(2);
    for (const editor of ["Image Editor", "Video Editor"]) {
      await page.getByRole("button", { name: editor, exact: true }).click();
      const trigger = page.getByRole("link", {
        name: `Enlarge ${editor} screenshot`,
      });
      await trigger.scrollIntoViewIfNeeded();
      await expect(trigger.locator("img")).toHaveJSProperty("complete", true);
      const original = await trigger.locator("img").boundingBox();
      await trigger.press("Enter");
      const close = page.getByRole("button", {
        name: `Close ${editor} screenshot`,
      });
      await expect(close).toBeFocused();
      const enlarged = page.locator(".medium-zoom-image--opened");
      await expect(enlarged).toBeVisible();
      await expect
        .poll(async () => {
          const box = await enlarged.boundingBox();
          return box
            ? box.width > original!.width &&
                box.width >=
                  Math.min(1440 - 32, ((900 - 32) * original!.width) / original!.height) - 2 &&
                Math.abs(box.y + box.height / 2 - 450) < 2 &&
                box.x >= 0 &&
                box.x + box.width <= 1440 + 1
            : false;
        })
        .toBe(true);
      await close.press("Escape");
      await expect(enlarged).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`composer zoom shows the ${scheme} screenshot variant`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "no-preference" });
      await page.goto("/");
      await dismissTelemetryConsent(page);
      await page.getByRole("button", { name: "Compose", exact: true }).click();
      const trigger = page.getByRole("link", { name: "Enlarge Compose screenshot" });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.press("Enter");
      await expect(page.getByRole("button", { name: "Close Compose screenshot" })).toBeFocused();
      // The zoomed clone lives outside <picture>, so it once showed the light
      // variant in dark mode. It must be a single node showing the page theme.
      const enlarged = page.locator(".medium-zoom-image--opened");
      await expect(enlarged).toHaveCount(1);
      const sources = await enlarged.evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).currentSrc),
      );
      expect(sources).toHaveLength(1);
      expect(sources[0]).toContain(scheme === "dark" ? "main-dark" : "main-light");
      await page.keyboard.press("Escape");
      await expect(enlarged).toHaveCount(0);
    });
  }

  test("screenshots remain direct image links without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: `Enlarge Compose screenshot` })).toHaveAttribute(
      "href",
      /\/assets\/screenshots\/.+\.webp$/,
    );
    await context.close();
  });
});

test.describe("marketing refresh", () => {
  const capture = process.env.OPENPOST_MARKETING_CAPTURE === "1";
  const captureDirectory = ".impeccable/review/marketing-refresh";

  test("the tour advances after five seconds and lets the visitor stop it", async ({ page }) => {
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const tour = page.getByRole("region", { name: "OpenPost screenshot tour" });
    await tour.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const picker = tour.getByRole("group", { name: "Explore OpenPost" });
    await expect(picker.getByRole("button", { name: "Compose", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(picker.getByRole("button", { name: "Image Editor", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 6500 },
    );
    await tour.getByRole("button", { name: "Pause screenshot tour" }).click();
    await page.mouse.move(0, 0);
    await page.clock.install();
    await page.clock.runFor(6000);
    await expect(picker.getByRole("button", { name: "Image Editor", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await tour.getByRole("button", { name: "Play screenshot tour" }).click();
    await page.mouse.move(0, 0);
    await page.clock.runFor(5500);
    await expect(picker.getByRole("button", { name: "Video Editor", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("reduced motion keeps the tour still and manual choices remain available", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const tour = page.getByRole("region", { name: "OpenPost screenshot tour" });
    await tour.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.clock.install();
    await page.clock.runFor(7000);
    await expect(tour.getByRole("button", { name: "Compose", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(tour.getByRole("button", { name: /screenshot tour/ })).toHaveCount(0);
    await tour.getByRole("button", { name: "Workflows", exact: true }).press("Enter");
    await expect(tour.getByRole("link", { name: "Enlarge Workflows screenshot" })).toBeVisible();
  });

  test("Features navigation opens the landing section from another page", async ({ page }) => {
    await page.goto("/about");
    await dismissTelemetryConsent(page);
    await page.locator("footer").getByRole("link", { name: "Features", exact: true }).click();
    await expect(page).toHaveURL(/\/#features$/);
    await expect(
      page.getByRole("heading", { name: "From the first idea to the next conversation." }),
    ).toBeInViewport();
  });

  const routes = [
    "",
    "platforms",
    "platforms/linkedin",
    "platforms/facebook",
    "platforms/instagram",
    "platforms/youtube",
    "platforms/tiktok",
    "tools",
    "tools/multi-platform-character-counter",
    "tools/post-preview-generator",
    "tools/social-media-video-editor",
    "about",
    "contact",
    "faq",
    "security",
    "trust",
    "guides",
    "changelog",
  ];
  for (const scheme of ["light", "dark"] as const) {
    test(`marketing pages fit 320px in ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      if (capture) await mkdir(captureDirectory, { recursive: true });
      for (const route of routes) {
        const response = await page.goto(`/${route}`);
        expect(response?.ok(), route).toBe(true);
        await dismissTelemetryConsent(page);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator(".ascii-wordmark canvas")).toHaveClass(/ready/, {
          timeout: 15_000,
        });
        await page.evaluate(async () => {
          document.querySelectorAll("img").forEach((image) => {
            image.loading = "eager";
          });
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((image) => image.decode().catch(() => undefined)),
          );
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          route,
        ).toBe(true);
        expect(
          await page
            .locator("main img")
            .evaluateAll((images) =>
              images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
            ),
          `${route} images`,
        ).toBe(true);
        if (capture) {
          if (route === "") {
          }
        }
      }
      expect(errors).toEqual([]);
    });
  }

  test("new page templates preserve accessible names and contrast", async ({ page }) => {
    test.setTimeout(120_000);
    for (const route of [
      "platforms/linkedin",
      "platforms/facebook",
      "platforms/instagram",
      "platforms/youtube",
      "tools/multi-platform-character-counter",
      "security",
    ]) {
      await page.goto(`/${route}`);
      await dismissTelemetryConsent(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations, route).toEqual([]);
    }
  });

  test("retired pages redirect readers to their replacement", async ({ request }) => {
    for (const [oldPath, replacement] of [
      ["/features", "/#features"],
      ["/features.md", "/index.md"],
      ["/developers", "https://openpo.st/docs/automate"],
      ["/self-hosting", "https://openpo.st/docs/self-hosting"],
    ]) {
      const response = await request.get(oldPath, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(replacement);
    }
  });

  test("channel examples show finished media and the YouTube business story", async ({ page }) => {
    for (const channel of ["facebook", "instagram", "tiktok", "youtube"]) {
      const response = await page.goto(`/platforms/${channel}`);
      expect(response?.ok()).toBe(true);
      const preview = page.locator("figure").first();
      const photo = preview.getByRole("img", { name: /green ceramic cup/ });
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      await expect(preview.getByText("Video preview", { exact: true })).toHaveCount(0);
      await expect(
        preview.getByText("Add a photo or video to preview an Instagram post"),
      ).toHaveCount(0);
      if (channel === "youtube")
        await expect(
          preview.getByRole("heading", { name: "From clay to coffee cup", exact: true }),
        ).toBeVisible();
    }
  });

  test("the counter keeps format limits beside its estimates", async ({ page }) => {
    await page.goto("/tools/multi-platform-character-counter");
    await page.getByRole("textbox", { name: "Post text" }).fill("a".repeat(2000));
    await expect(page.getByRole("progressbar", { name: "Telegram character use" })).toHaveAttribute(
      "aria-valuenow",
      "2000",
    );
    await expect(page.getByText(/media captions allow up to 1,024/)).toBeVisible();
    await expect(page.getByText(/an instance can set a different limit/)).toBeVisible();
  });
});

test.describe("dither", () => {
  test("CTA dithering changes pixel density on hover and keyboard focus", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const button = page.getByRole("link", { name: "Start your free trial" }).first();
    await expect(button).toBeVisible();
    const mask = () => button.evaluate((el) => getComputedStyle(el, "::before").maskImage);
    await page.mouse.move(0, 0);
    await expect.poll(mask).toContain("data:image/svg+xml");
    await expectBalancedDitherButton(button);
    const rest = await mask();
    await button.hover();
    await expect.poll(mask).not.toBe(rest);
    await expectBalancedDitherButton(button);
    await page.mouse.move(0, 0);
    await expect.poll(mask).toBe(rest);
    await page.keyboard.press("Tab");
    await button.focus();
    await expect.poll(mask).not.toBe(rest);
    await expectBalancedDitherButton(button);
    await page.emulateMedia({ forcedColors: "active" });
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el, "::before").display))
      .toBe("none");
    await page.emulateMedia({ forcedColors: "none" });
  });
});

test.describe("centered headings", () => {
  for (const route of ["/", "/contact", "/platforms"]) {
    test(`${route} keeps its headline and supporting copy centered`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.route("https://app.openpo.st/api/v1/github-stars", (route) =>
        route.fulfill({ json: { count: 900 } }),
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      const widths = route === "/" ? [1867, 1280, 390, 320] : [1440, 390, 320];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await dismissTelemetryConsent(page);
        await page.evaluate(() => document.fonts.ready);
        const heading = page.getByRole("heading", { level: 1 });
        const geometry = await heading.evaluate((node) => {
          const title = node.getBoundingClientRect();
          const parent = node.parentElement!.getBoundingClientRect();
          const copy = node.parentElement!.querySelector("p")!.getBoundingClientRect();
          const center = parent.x + parent.width / 2;
          return {
            headingOffset: Math.abs(title.x + title.width / 2 - center),
            copyOffset: Math.abs(copy.x + copy.width / 2 - center),
            lines: title.height / Number.parseFloat(getComputedStyle(node).lineHeight),
            alignment: getComputedStyle(node).textAlign,
          };
        });
        expect(geometry.headingOffset).toBeLessThan(1);
        expect(geometry.copyOffset).toBeLessThan(1);
        expect(geometry.alignment).toBe("center");
        if (route === "/" && width >= 1280) expect(geometry.lines).toBeCloseTo(2, 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("brand contrast", () => {
  test("public logo remains legible when the visitor switches appearance", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await dismissTelemetryConsent(page);
    const header = page.locator("header.marketing-nav");
    const logo = header.getByRole("link", { name: "OpenPost home", exact: true }).locator("img");
    const colors = [];

    for (const scheme of ["light", "dark", "light"] as const) {
      const switchTheme = header.getByRole("button", {
        name: `Use ${scheme} theme`,
      });
      const navigation = header.getByRole("button", {
        name: "Open navigation",
        exact: true,
      });
      if (await navigation.isVisible()) await navigation.click();
      const currentScheme = await page
        .locator("html")
        .evaluate((html) => (html.classList.contains("dark") ? "dark" : "light"));
      if (currentScheme !== scheme) await switchTheme.click();
      const closeNavigation = header.getByRole("button", {
        name: "Close navigation",
        exact: true,
      });
      if (await closeNavigation.isVisible()) await closeNavigation.click();
      if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

      const pixels = await logo.evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 64, 64);
        return Array.from(context.getImageData(12, 12, 1, 1).data);
      });
      expect(pixels[3]).toBe(255);
      colors.push(pixels.slice(0, 3));
      const luminance = (rgb: number[]) =>
        rgb
          .map((value) => value / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const ink = luminance(pixels.slice(0, 3));
      const surface = luminance(scheme === "light" ? [255, 255, 255] : [13, 17, 23]);
      expect(
        (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
      await expect(logo).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    expect(colors[0]).not.toEqual(colors[1]);
    expect(colors[2]).toEqual(colors[0]);
  });

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
