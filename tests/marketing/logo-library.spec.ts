import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dismissTelemetryConsent } from "./helpers";

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

test("icon search understands Lucide tags, aliases, categories and spelling", async ({ page }) => {
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
