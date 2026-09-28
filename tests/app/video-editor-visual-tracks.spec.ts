import { expect, test } from "@playwright/test";

test("a background moves between visual tracks with undo, cancel and persistence", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "light"));
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
  await page.getByRole("button", { name: "Open Video Editor", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Assets", exact: true })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("Sunset mesh");
  await page.getByRole("button", { name: "Sunset mesh", exact: true }).click();
  const source = page.locator('[data-track="track-video-main"]');
  const destination = page.locator('[data-track="track-video-overlay"]');
  const clip = page.locator("[data-timeline-item-id]");
  await expect(source.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page.getByRole("tab", { name: "Backgrounds", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(clip).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(clip).toHaveCount(1);

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
  await expect(page.getByRole("banner").getByRole("status")).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Editor workspaces" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(destination.locator("[data-timeline-item-id]")).toHaveCount(1);
  await page
    .getByRole("navigation", { name: "Assets", exact: true })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Backgrounds", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search backgrounds" }).fill("Ocean mesh");
  await page.getByRole("button", { name: "Ocean mesh", exact: true }).click();
  const sunset = page.getByRole("button", { name: /^Sunset mesh\. Drag/ });
  const ocean = page.getByRole("button", { name: /^Ocean mesh\. Drag/ });
  await sunset.click();
  await ocean.click({ modifiers: ["Shift"] });
  await expect(page.getByRole("heading", { name: "2 clips selected" })).toBeVisible();
  await ocean.click();
  await expect(page.getByRole("heading", { name: "Ocean mesh", exact: true })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(ocean).toHaveCount(0);
  await expect(sunset).toHaveCount(1);
  await sunset.click();
  await page.getByRole("textbox", { name: "Width", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("inspector-light-desktop.png") });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page
        .getByRole("navigation", { name: "Editor panels" })
        .getByRole("button", { name: "Edit", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Width", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`inspector-light-${width}.png`) });
  }
});
