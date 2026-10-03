import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("testing a lower theme card brings its sample into view on every layout", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `theme-preview-location-${randomUUID()}@example.com`);
  await createWorkspace(request, auth.token, "Theme sample location");
  await authenticatePage(page, auth.token);
  const writes: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/v1\/(theme|organization)/.test(req.url()) && req.method() !== "GET")
      writes.push(req.method());
  });
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/settings?tab=appearance");
      const choice = page.getByRole("button", { name: "Test Dither Moss", exact: true });
      await choice.scrollIntoViewIfNeeded();
      await choice.focus();
      await page.keyboard.press("Enter");
      const sample = page.locator('iframe[title="Dither Moss dashboard preview"]');
      await expect(sample).toBeVisible();
      await expect(sample).toHaveAttribute("aria-busy", "false");
      await page.screenshot({ path: info.outputPath(`preview-location-${width}-${scheme}.png`) });
      await expect
        .poll(async () => {
          const box = await sample.boundingBox();
          return box !== null && box.y >= 0 && box.y < 750;
        })
        .toBe(true);
      await page.getByRole("button", { name: "Stop testing", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme-id", "dither");
    }
  expect(writes).toEqual([]);
});
