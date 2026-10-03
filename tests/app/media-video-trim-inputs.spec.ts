import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("video preparation commits its accepted trim bounds after keyboard edits", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `trim-input-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Trim input admission");
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles("tests/app/fixtures/product-screenshots/study-sos-demo.mp4");
  await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit video", exact: true });
  const start = dialog.getByRole("spinbutton", { name: "Start", exact: true });
  const end = dialog.getByRole("spinbutton", { name: "End", exact: true });
  await expect(start).toHaveValue("0", { timeout: 30000 });
  const duration = await dialog
    .locator("video")
    .evaluate((video: HTMLVideoElement) => video.duration);
  expect(duration).toBeGreaterThan(1);
  await start.fill("-2");
  await start.press("Tab");
  await page.screenshot({ path: testInfo.outputPath("start-after-blur.png") });
  await expect(start).toHaveValue("0");
  await end.fill("9999");
  await end.press("Tab");
  await expect(end).toHaveValue(String(duration));
  await start.fill("");
  await start.pressSequentially("0.70");
  await expect(start).toHaveValue("0.70");
  await start.press("Tab");
  await expect(start).toHaveValue("0.7");
  await end.fill("0.2");
  await end.press("Tab");
  expect(Number(await end.inputValue())).toBeCloseTo(0.8, 5);
  await start.fill("-2");
  await start.press("Enter");
  await expect(start).toHaveValue("0");
  await start.fill("0.7");
  await start.press("Tab");
  await end.fill(String(duration));
  await end.press("Tab");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toHaveValue("0.7");
      await expect(end).toHaveValue(String(duration));
      await page.screenshot({ path: testInfo.outputPath(`trim-${width}-${scheme}.png`) });
    }
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(start).toHaveValue("0");
  await expect(end).toHaveValue(String(duration));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(errors).toEqual([]);
});
