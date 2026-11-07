import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("video preparation commits its accepted trim bounds after keyboard edits", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `trim-input-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Trim input admission");
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
  for (const scheme of ["light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toHaveValue("0.7");
      await expect(end).toHaveValue(String(duration));
      for (const name of ["Upload without editing", "Cancel", "Apply edit"]) {
        const action = dialog.getByRole("button", { name, exact: true });
        await expect(action).toBeInViewport({ ratio: 1 });
        expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`trim-${width}-${scheme}.png`) });
    }
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(start).toHaveValue("0");
  await expect(end).toHaveValue(String(duration));
  await end.fill("1");
  await end.press("Tab");
  await dialog.getByRole("button", { name: "Apply edit", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Open details for study-sos-demo-edited.mp4",
      exact: true,
    }),
  ).toBeVisible();
  const inventory = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(inventory.ok()).toBe(true);
  const { media: items } = await inventory.json();
  expect(items).toHaveLength(1);
  const media = items[0];
  expect(media.original_filename).toBe("study-sos-demo-edited.mp4");
  const stored = await request.get(media.url, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(stored.ok()).toBe(true);
  const outputPath = testInfo.outputPath("trimmed.mp4");
  await writeFile(outputPath, await stored.body());
  const { stdout } = await promisify(execFile)(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,codec_type",
      "-of",
      "json",
      outputPath,
    ],
    { timeout: 30_000 },
  );
  const details = JSON.parse(stdout);
  expect(Number(details.format.duration)).toBeCloseTo(1, 1);
  expect(details.streams).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: "h264" }),
      expect.objectContaining({ codec_type: "audio", codec_name: "aac" }),
    ]),
  );
  expect(errors).toEqual([]);
});
