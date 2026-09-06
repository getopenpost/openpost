import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dismissTelemetryConsent } from "./helpers.js";

test("landing preview switches destination copy without leaving the launch", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await dismissTelemetryConsent(page);
  const preview = page.getByRole("group", { name: "Preview a destination" });
  await expect(preview.getByRole("button", { name: "LinkedIn", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await preview.getByRole("button", { name: "Bluesky", exact: true }).click();
  await expect(page.getByText("Bluesky rendition", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A small thing we’ve been working on: Fieldnotes.", { exact: false }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Instagram", exact: true }).press("Enter");
  await expect(page.getByText("Instagram rendition", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Room for your next good idea. Meet Fieldnotes", { exact: false }),
  ).toBeVisible();
  await expect(preview.getByRole("button", { name: "Bluesky", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(errors).toEqual([]);
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
  await expect(page.locator("details[open]")).toContainText("14");
  await context.close();
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
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        await page
          .locator("img")
          .evaluateAll((images) =>
            images
              .filter((image) => image.loading !== "lazy")
              .every((image) => image.complete && image.naturalWidth > 0),
          ),
      ).toBe(true);
      if (process.env.OPENPOST_CAPTURE_LANDING === "1") {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: testInfo.outputPath(`hero-${width}-${colorScheme}.png`) });
        for (const heading of ["studio-title", "schedule-title", "tour-title", "closing-title"]) {
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
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation.getByRole("link", { name: "Features", exact: true })).toHaveCount(1);
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
