import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { dismissTelemetryConsent } from "./helpers";

const capture = process.env.OPENPOST_MARKETING_CAPTURE === "1";
const captureDirectory = ".impeccable/review/marketing-refresh";

test("the tour advances after five seconds and lets the visitor stop it @desktop", async ({
  page,
}) => {
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

test("reduced motion keeps the tour still and manual choices remain available @desktop", async ({
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
  await tour.getByRole("button", { name: "Accounts", exact: true }).press("Enter");
  await expect(tour.getByRole("link", { name: "Enlarge Accounts screenshot" })).toBeVisible();
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
for (const width of [1440, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`marketing pages fit ${width}px in ${scheme} @desktop`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
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
          await page.screenshot({
            path: `${captureDirectory}/${route.replaceAll("/", "-") || "home"}-${width}-${scheme}.png`,
            fullPage: true,
            animations: "disabled",
          });
          if (route === "") {
            await page.screenshot({
              path: `${captureDirectory}/hero-${width}-${scheme}.png`,
              animations: "disabled",
            });
            await page.locator("footer").screenshot({
              path: `${captureDirectory}/footer-${width}-${scheme}.png`,
              animations: "disabled",
              style: ".marketing-nav { visibility: hidden; }",
            });
          }
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test("new page templates preserve accessible names and contrast @desktop", async ({ page }) => {
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

test("retired pages redirect readers to their replacement @desktop", async ({ request }) => {
  test.skip(
    process.env.OPENPOST_E2E_PREBUILT !== "1",
    "Redirects are handled by Cloudflare Pages.",
  );
  for (const [oldPath, replacement] of [
    ["/features", "/#features"],
    ["/features.md", "/index.md"],
    ["/developers", "https://docs.openpo.st/guides/automation"],
    ["/self-hosting", "https://docs.openpo.st/self-hosting"],
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
