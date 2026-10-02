import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Device upload offers explicit attachment and cancellation without switching to Library", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const auth = await registerUser(request, `picker-handoff-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Device attachment handoff");
  await authenticatePage(page, auth.token);
  await page.goto("/templates");
  await page.getByRole("button", { name: "Meme", exact: true }).click();
  await page.getByRole("textbox", { name: "Search templates", exact: true }).fill("Bongo Cat");
  await page.getByRole("textbox", { name: "Search templates", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Use the Bongo Cat template", exact: true }).click();
  await expect(page.getByRole("button", { name: "Image 1", exact: true })).toBeVisible();
  const file = {
    name: "device-overlay.gif",
    mimeType: "image/gif",
    buffer: await readFile("tests/app/fixtures/media-picker-overlay.gif"),
  };
  async function upload() {
    await page.getByRole("button", { name: "Image 1", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Image 1", exact: true });
    await picker.getByRole("tab", { name: "Device", exact: true }).click();
    await picker.locator('input[type="file"]').setInputFiles(file);
    await picker.getByRole("button", { name: "Upload 1 file", exact: true }).click();
    await expect(picker.getByText("1 of 1 selected", { exact: true })).toBeVisible();
    await expect(picker.getByRole("tab", { name: "Device", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(picker.getByRole("button", { name: "Add media", exact: true })).toBeEnabled();
    return picker;
  }
  const first = await upload();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(first.getByRole("button", { name: "Add media", exact: true })).toBeInViewport();
      await expect(first.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`device-${width}-${scheme}.png`),
      });
    }
  }
  await first.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(first).toBeHidden();
  await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeDisabled();
  const second = await upload();
  const confirm = second.getByRole("button", { name: "Add media", exact: true });
  await second.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(second).toBeHidden();
  await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeEnabled();
  await expect(page.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Image 2", exact: true })).toBeEnabled();
  const touchContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: { width: 320, height: 850 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  try {
    const touch = await touchContext.newPage();
    await authenticatePage(touch, auth.token);
    await touch.goto(page.url());
    await touch.getByRole("button", { name: "Image 2", exact: true }).tap();
    const picker = touch.getByRole("dialog", { name: "Image 2", exact: true });
    await picker.getByRole("tab", { name: "Device", exact: true }).tap();
    await picker.locator('input[type="file"]').setInputFiles(file);
    await picker.getByRole("button", { name: "Upload 1 file", exact: true }).tap();
    const attach = picker.getByRole("button", { name: "Add media", exact: true });
    await expect(attach).toBeEnabled();
    await expect(attach).toBeInViewport();
    expect((await attach.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await touch.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("device-320-coarse.png"),
    });
    await picker.getByRole("button", { name: "Cancel", exact: true }).tap();
    await expect(picker).toBeHidden();
    await expect(touch.getByRole("img", { name: "Image 2", exact: true })).toHaveCount(0);
  } finally {
    await touchContext.close();
  }
});
