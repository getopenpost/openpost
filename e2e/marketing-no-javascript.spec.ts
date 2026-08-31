import { expect, test } from "@playwright/test";

const toolRoutes = [
  ["social-media-video-editor", "Video files, camera, screen, or microphone recordings"],
  ["social-media-image-editor", "Images, text, shapes, and blank pages"],
  ["multi-platform-character-counter", "One text draft"],
  ["post-preview-generator", "Post text and a selected social network"],
  ["thread-splitter", "One long text draft"],
  ["fediverse-handle-checker", "A Mastodon-style or Bluesky-style handle"],
  ["linkedin-text-formatter", "One LinkedIn draft"],
  ["best-time-to-post-calculator", "Audience days, hours, and timezone"],
  ["utm-link-builder", "A full page link"],
] as const;

test.describe("browser tools without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  for (const [slug, input] of toolRoutes) {
    test(`${slug} keeps its complete explanation`, async ({ page }) => {
      await page.goto(`/tools/${slug}`);
      await expect(
        page.getByRole("heading", { level: 2, name: "Who this is for", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Inputs", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(input, { exact: false })).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Outputs", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Limits", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Privacy", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Next step", exact: true }),
      ).toBeVisible();
    });
  }
});
