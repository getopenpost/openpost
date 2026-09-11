import { expect, test } from "@playwright/test";

test("a background moves between visual tracks with undo, cancel and persistence", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        const handle = await navigator.storage.getDirectory();
        const prototype = Object.getPrototypeOf(handle);
        prototype.queryPermission = async () => "granted";
        prototype.requestPermission = async () => "granted";
        return handle;
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/video-editor");
  await page.getByRole("button", { name: "Choose folder", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("Sunset mesh");
  await page.getByRole("button", { name: "Sunset mesh", exact: true }).click();
  const source = page.locator('[data-track="track-video-overlay"]');
  const destination = page.locator('[data-track="track-video-main"]');
  const clip = page.locator("[data-timeline-item-id]");
  await expect(source.locator("[data-timeline-item-id]")).toHaveCount(1);
  const start = await clip.boundingBox();
  const target = await destination.boundingBox();
  expect(start).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2, target!.y + target!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(source.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
  const moved = await clip.boundingBox();
  const original = await source.boundingBox();
  await page.mouse.move(moved!.x + moved!.width / 2, moved!.y + moved!.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved!.x + moved!.width / 2, original!.y + original!.height / 2, {
    steps: 8,
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("All changes saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
});
