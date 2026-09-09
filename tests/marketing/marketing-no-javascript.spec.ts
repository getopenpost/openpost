import { expect, test } from "@playwright/test";

const toolRoutes = [
  "social-media-video-editor",
  "social-media-image-editor",
  "multi-platform-character-counter",
  "post-preview-generator",
  "thread-splitter",
  "fediverse-handle-checker",
  "linkedin-text-formatter",
  "best-time-to-post-calculator",
  "utm-link-builder",
];

test.describe("browser tools without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("every tool keeps a useful guide and working questions", async ({ page }) => {
    for (const slug of toolRoutes) {
      await page.goto(`/tools/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "How to use it", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Common questions", exact: true }),
      ).toBeVisible();
      const question = page.getByRole("article").locator("details").first();
      await question.locator("summary").click();
      await expect(question.locator("p")).toBeVisible();
      const links = page.getByRole("link", { name: "All free tools", exact: true });
      await expect(links).toHaveAttribute("href", "/tools");
    }
  });
});
