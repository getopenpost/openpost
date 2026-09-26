import { expect, test } from "@playwright/test";

async function select(page: import("@playwright/test").Page, name: string, option: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("preview workspace keeps the draft when changing screen, appearance, and view", async ({
  page,
}) => {
  await page.goto("/tools");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Previews", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search free tools" }).fill("LinkedIn");
  await page.getByRole("link", { name: /LinkedIn post preview/ }).click();
  await expect(
    page.getByRole("heading", { name: "LinkedIn post preview", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Post copy").fill("A launch worth explaining in our own words.");
  await expect(page.locator("[data-preview-viewport]")).toContainText("A launch worth explaining");
  await select(page, "Preview screen width", "Small phone · 320px");
  await expect(page.locator("[data-preview-viewport]")).toHaveCSS("width", "320px");
  await select(page, "Preview appearance", "Dark");
  await select(page, "Preview view", "Post card");
  await expect(page.locator('[aria-label="LinkedIn post preview"]')).toContainText(
    "A launch worth explaining in our own words.",
  );
  await expect(page.getByLabel("Post copy")).toHaveValue(
    "A launch worth explaining in our own words.",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("local media selection uses the destination limit without silently discarding files", async ({
  page,
}) => {
  await page.goto("/tools/post-preview-generator");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Post details/ }).click();
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=",
    "base64",
  );
  const files = Array.from({ length: 5 }, (_, index) => ({
    name: `photo-${index}.png`,
    mimeType: "image/png",
    buffer: image,
  }));
  await page.locator('input[type="file"]').setInputFiles(files);
  await expect(page.getByRole("alert")).toContainText("Choose up to 4 images");
  await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(0);
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  await select(page, "Platform", "LinkedIn");
  await page.getByRole("button", { name: /Post details/ }).click();
  await page.locator('input[type="file"]').setInputFiles(files);
  await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(5);
  await page.getByRole("button", { name: "Remove photo-2.png", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Remove photo-4.png", exact: true })).toBeVisible();
});
