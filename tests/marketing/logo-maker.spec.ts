import { test, expect } from "@playwright/test";
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
});
