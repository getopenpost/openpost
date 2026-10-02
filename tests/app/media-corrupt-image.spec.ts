import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Media upload reports corrupt PNG failure without a ready library asset", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `media-corrupt-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Image decode admission");
  await authenticatePage(page, auth.token);
  await page.goto("/media");
  await page.getByRole("button", { name: "Add media", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("This signature has no image pixels."),
    ]),
  });
  await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(page.getByText("image file could not be decoded", { exact: true })).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("dark", value === "dark"),
      scheme,
    );
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(page.getByRole("alert")).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Remove corrupt.png", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`corrupt-${width}-${scheme}.png`),
      });
    }
  }
  const response = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).media).toEqual([]);
  await page.getByRole("button", { name: "Remove corrupt.png", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "valid.png",
    mimeType: "image/png",
    buffer: await readFile("tests/app/fixtures/product-screenshots/openpost-logo.png"),
  });
  await page.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open details for valid.png", exact: true }),
  ).toBeVisible();
  const recovered = await request.get(`/api/v1/media?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const records = (await recovered.json()).media;
  expect(records).toHaveLength(1);
  expect(records[0].processing_status).toBe("ready");
  expect(records[0].width).toBeGreaterThan(0);
  expect(records[0].height).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open details for corrupt.png", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open details for valid.png", exact: true }).click();
  const inspector = page.getByRole("dialog", { name: "valid.png", exact: true });
  await expect(inspector.getByRole("img").first()).toBeVisible();
  await expect
    .poll(() =>
      inspector
        .getByRole("img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
});
