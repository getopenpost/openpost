import { expect, test } from "@playwright/test";
import { dismissTelemetryConsent } from "./helpers";

const photoFixture = "tests/app/fixtures/product-screenshots/lisbon-tram.png";

async function select(page: import("@playwright/test").Page, name: string, option: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("preview workspace keeps the draft when changing screen, appearance, and view", async ({
  page,
}) => {
  await page.goto("/tools");
  await page.waitForLoadState("networkidle");
  await dismissTelemetryConsent(page);
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
  await dismissTelemetryConsent(page);
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
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("exceeds the 4-image preview limit");
  await page.getByRole("button", { name: /Post details/ }).click();
  await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(5);
  await page.getByRole("button", { name: "Remove photo-2.png", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Remove photo-/ })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Remove photo-4.png", exact: true })).toBeVisible();
});

test("channel and carousel previews accept mixed photo and video attachments", async ({ page }) => {
  await page.goto("/tools/discord-post-preview");
  await page.waitForLoadState("networkidle");
  await dismissTelemetryConsent(page);
  for (const platform of ["Instagram", "Discord", "Threads", "Telegram"]) {
    await select(page, "Platform", platform);
    await page.getByRole("button", { name: /Post details/ }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles([photoFixture, "tests/app/fixtures/product-screenshots/study-sos-demo.mp4"]);
    await expect(
      page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove study-sos-demo.mp4", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "View preview", exact: true }).click();
    if (platform === "Instagram") {
      const preview = page.locator("[data-preview-viewport]");
      await preview.getByRole("button", { name: "Next media", exact: true }).click();
      await expect(preview.locator("video")).toBeVisible();
      await expect(preview.locator("video")).toHaveAttribute("src", /^blob:/);
      for (const format of ["story", "reel"]) {
        await select(page, "Format", format);
        await page.getByRole("button", { name: /Post details/ }).click();
        await page
          .locator('input[type="file"]')
          .setInputFiles([
            photoFixture,
            "tests/app/fixtures/product-screenshots/study-sos-demo.mp4",
          ]);
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await page.getByRole("button", { name: "View preview", exact: true }).click();
      }
      await select(page, "Format", "post");
    }
  }
  await select(page, "Format", "video");
  await expect(page.getByRole("alert")).toContainText("hidden from the preview");
  await page.getByRole("button", { name: /Post details/ }).click();
  await expect(
    page.getByRole("button", { name: "Remove lisbon-tram.png", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove study-sos-demo.mp4", exact: true }),
  ).toBeVisible();
});

test("an oversized poll keeps every option visible and explains the limit", async ({ page }) => {
  await page.goto("/tools/x-post-preview");
  await page.waitForLoadState("networkidle");
  await dismissTelemetryConsent(page);
  await page.getByRole("button", { name: /Post details/ }).click();
  await page.getByRole("checkbox", { name: "Include a poll" }).check();
  await page.getByLabel("Poll options, up to 4").fill("One\nTwo\nThree\nFour\nFive");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  await expect(page.getByLabel("Poll preview")).toContainText("Five");
  await expect(page.getByRole("status")).toContainText("poll exceeds the 4-option preview limit");
});

test("Story previews preserve the post draft and media while hiding unused copy", async ({
  page,
}) => {
  await page.goto("/tools/instagram-post-preview");
  await page.waitForLoadState("networkidle");
  await dismissTelemetryConsent(page);
  await page.getByLabel("Post copy").fill("A caption for the feed, kept for later.");
  await page.getByRole("button", { name: /Post details/ }).click();
  await page.locator('input[type="file"]').setInputFiles(photoFixture);
  await page.getByLabel("Media alt text", { exact: true }).fill("A tram in Lisbon");
  await page.getByRole("button", { name: "View preview", exact: true }).click();
  await select(page, "Format", "story");
  await expect(page.getByLabel("Post copy")).toHaveCount(0);
  await expect(
    page.getByText("Text must be part of your image or video.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("[data-preview-viewport]").getByRole("img", { name: "A tram in Lisbon" }),
  ).toBeVisible();
  await select(page, "Format", "post");
  await expect(page.getByLabel("Post copy")).toHaveValue("A caption for the feed, kept for later.");
  await expect(
    page.locator("[data-preview-viewport]").getByRole("img", { name: "A tram in Lisbon" }),
  ).toBeVisible();
});
