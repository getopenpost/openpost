import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) document.documentElement.dataset.requestedDownload = this.download;
    };
  });
});

test("Image Editor distinguishes an export request from browser file delivery", async ({
  page,
}) => {
  await page.goto("/image-editor");
  await page.getByRole("button", { name: /Instagram square/ }).click();
  await expect(page.getByRole("application", { name: "Design canvas" })).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export design" })
    .getByRole("button", { name: "Download", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
  await expect(page.getByText("Export download started.", { exact: true }).first()).toBeVisible({
    timeout: 2000,
  });
});

test("Quick Cut describes frame download requests after real video decoding", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `cut-download-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Quick Cut downloads");
  await authenticatePage(page, auth.token);
  await page.addInitScript(() =>
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
  );
  await page.goto("/quick-cut");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open videos", exact: true }).click();
  await (await chooser).setFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Capture current frame", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
  const file = await page.locator("html").getAttribute("data-requested-download");
  await expect(
    page.getByText(`Download started for ${file}.`, { exact: true }).first(),
  ).toBeVisible({ timeout: 2000 });
});

test("Video Editor distinguishes verified project media from its frame download request", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `video-download-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Video frame downloads");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Assets", exact: true })
    .getByRole("button", { name: "Add layer", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add text", exact: true }).click();
  await expect(page.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page
    .locator("[data-video-transport]")
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Save current frame", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-requested-download", /\.png$/);
  const file = await page.locator("html").getAttribute("data-requested-download");
  await expect(page.locator("[data-project-summary]")).toContainText(/(?:1 media|Media: 1)/);
  await expect(
    page.getByText(`Saved ${file} to project media. Download started.`, { exact: true }).first(),
  ).toBeVisible({ timeout: 5000 });
});
