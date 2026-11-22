import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

test.describe("logo library", () => {
  test("logo library loads batches and searches the full collection", async ({ page }) => {
    const scripts = new Set<string>();
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.add(request.url());
    });
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    const collection = page.getByLabel("Icon collection", { exact: true });
    await expect(collection.getByRole("button")).toHaveCount(40);
    await expect(collection.locator("svg")).toHaveCount(40);
    const initialRequests = scripts.size;
    expect(initialRequests).toBeLessThan(300);
    await collection.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(collection.getByRole("button")).toHaveCount(80);
    await expect(collection.locator("svg")).toHaveCount(80);
    expect(scripts.size).toBeGreaterThan(initialRequests);
    await page.getByRole("textbox", { name: "Search icons" }).fill("worm");
    await collection.getByRole("button", { name: "Worm", exact: true }).click();
    await expect(page.locator('svg[aria-label="Logo preview"] svg')).toHaveClass(/lucide-worm/);
    await page.getByRole("textbox", { name: "Search icons" }).fill("not-a-real-icon");
    await expect(collection).toContainText("No icons match.");
    await page.getByRole("textbox", { name: "Search icons" }).fill("");
    await expect(collection.getByRole("button")).toHaveCount(40);
  });

  test("logo color opacity survives PNG export", async ({ page }) => {
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    await page.getByRole("button", { name: "Minimal", exact: true }).click();
    await page.getByRole("textbox", { name: "Search icons" }).fill("circle");
    await page
      .getByLabel("Icon collection", { exact: true })
      .getByRole("button", { name: "Circle", exact: true })
      .click();
    await expect(page.locator('svg[aria-label="Logo preview"] > svg')).toHaveClass(/lucide-circle/);
    await page.getByRole("button", { name: "Icon color", exact: true }).click();
    const opacity = page.getByRole("spinbutton", { name: "Opacity (%)", exact: true });
    await opacity.fill("50");
    await opacity.press("Tab");
    await page.keyboard.press("Escape");
    await expect(page.locator('svg[aria-label="Logo preview"] > svg')).toHaveAttribute(
      "stroke-opacity",
      "0.5",
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    const file = await pending;
    const stats = await sharp(await readFile((await file.path())!)).stats();
    expect(stats.channels[3].max).toBeGreaterThanOrEqual(127);
    expect(stats.channels[3].max).toBeLessThanOrEqual(128);
  });

  test("icon search understands Lucide tags, aliases, categories and spelling", async ({
    page,
  }) => {
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    const search = page.getByRole("textbox", { name: "Search icons" });
    const collection = page.getByLabel("Icon collection", { exact: true });
    for (const [query, name] of [
      ["magnifying glass", "Search"],
      ["launch", "Rocket"],
      ["home", "House"],
      ["stars", "Sparkles"],
      ["fork knife", "Utensils"],
      ["roket", "Rocket"],
    ]) {
      await search.fill(query);
      await expect(collection.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await search.fill("gaming");
    await expect(collection.getByRole("button").first()).toBeVisible();
    await search.fill("circle");
    await expect(collection.getByRole("button").first()).toHaveAccessibleName("Circle");
  });
});

test.describe("logo export focus", () => {
  test("PNG export keeps keyboard focus and rejects repeated requests while encoding", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const encode = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        document.documentElement.dataset.encodingRequested = "true";
        document.addEventListener(
          "release-png-encoding",
          () => encode.call(this, callback, type, quality),
          { once: true },
        );
      };
      HTMLAnchorElement.prototype.click = function () {
        if (this.download)
          document.documentElement.dataset.downloadRequests = String(
            Number(document.documentElement.dataset.downloadRequests ?? 0) + 1,
          );
      };
    });
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    const png = page.getByRole("button", { name: "PNG", exact: true });
    await png.focus();
    await png.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-encoding-requested", "true");
    await expect(png).toBeFocused({ timeout: 2000 });
    await expect(png).toHaveAttribute("aria-disabled", "true");
    await png.press("Enter");
    await page.evaluate(() => document.dispatchEvent(new Event("release-png-encoding")));
    await expect(page.getByText("PNG download started.", { exact: true })).toBeVisible();
    await expect(png).toHaveAttribute("aria-disabled", "false");
    await expect(png).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-download-requests", "1");
  });
});

test.describe("logo icon names", () => {
  test("logo icon variants have distinct names and keyboard selection", async ({ page }) => {
    await page.goto("/tools/logo-maker");
    await dismissTelemetryConsent(page);
    await page.getByRole("textbox", { name: "Search icons", exact: true }).fill("flower");
    const collection = page.locator('[aria-label="Icon collection"]');
    const original = collection.getByRole("button", { name: "Flower", exact: true });
    const variant = collection.getByRole("button", { name: "Flower 2", exact: true });
    await expect(variant).toBeVisible({ timeout: 2000 });
    await expect(original).toHaveCount(1);
    await expect(variant).toHaveAttribute("title", "Flower 2");
    await variant.focus();
    await variant.press("Enter");
    await expect(variant).toHaveAttribute("aria-pressed", "true");
    await expect(original).toHaveAttribute("aria-pressed", "false");
    await original.focus();
    await original.press("Enter");
    await expect(original).toHaveAttribute("aria-pressed", "true");
    await expect(variant).toHaveAttribute("aria-pressed", "false");
    await page.setViewportSize({ width: 1280, height: 900 });
    const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
    const phone = await navigation.isVisible();
    if (phone) await navigation.click();
    const theme = page.getByRole("button", { name: `Use light theme`, exact: true });
    if (await theme.isVisible()) await theme.click();
    if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await variant.scrollIntoViewIfNeeded();
    await variant.focus();
    await expect(variant).toBeInViewport();
  });
});
