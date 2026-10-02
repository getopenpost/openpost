import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("invalid brand fonts explain the file problem and allow a valid upload afterwards", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `font-upload-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Font upload recovery");
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=brand&workspace=${workspace.id}`);
  await page.getByText("Add a custom font", { exact: true }).click();
  await page.getByRole("textbox", { name: "Family name", exact: true }).fill("Recovery Geist");
  await page.getByRole("checkbox", { name: /I confirm that this workspace/ }).check();
  const input = page.getByLabel("Upload font", { exact: true });
  const invalid = { name: "broken.ttf", mimeType: "font/ttf", buffer: Buffer.from("not a font") };
  await input.setInputFiles(invalid);
  const alert = page.getByRole("alert").filter({ hasText: /font|network/i });
  await expect(alert).toHaveText(
    "This font file could not be read. Choose a valid WOFF2, TTF, or OTF file.",
  );
  await expect(input).toHaveValue("");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await alert.scrollIntoViewIfNeeded();
      await expect(alert).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`invalid-font-${colorScheme}-${width}.png`),
      });
    }
  }
  await input.setInputFiles(invalid);
  await expect(alert).toBeVisible();
  await expect(input).toBeEnabled();
  const fontPath = fileURLToPath(
    new URL("../../assets/brand/fonts/Geist-Regular.ttf", import.meta.url),
  );
  await page.route(/\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "Font storage is full." }),
    }),
  );
  await input.setInputFiles(fontPath);
  await expect(alert).toHaveText("Font storage is full.");
  await expect(input).toHaveValue("");
  await page.unroute(/\/api\/v1\/media\/upload(?:-session)?(?:\?|$)/);
  await input.setInputFiles(fontPath);
  await expect(page.getByText("Recovery Geist", { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Save brand kit", exact: true }).click();
  await expect(page.getByText("Brand kit saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Recovery Geist", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
