import { expect, test } from "@playwright/test";
import { createWorkspace, registerUser } from "./helpers";

test("Recorder keeps its identity and save controls usable on phones", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const { token } = await registerUser(request, `recorder-layout-${Date.now()}@example.com`);
  await createWorkspace(request, token, "Recorder layout");
  await page
    .context()
    .addCookies([
      { name: "openpost_session", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" },
    ]);
  await page.goto("/record");
  const header = page.locator("header");
  const local = header.getByRole("button", { name: "Local only", exact: true });
  const cloud = header.getByRole("button", { name: "Saved to OpenPost", exact: true });
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(
        header.getByRole("link", { name: "OpenPost Recorder", exact: true }),
      ).toBeVisible();
      await expect(local).toBeVisible();
      await expect(cloud).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      for (const button of [local, cloud]) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(button).toHaveAttribute("aria-pressed", "true");
      }
      await page.screenshot({ path: testInfo.outputPath(`recorder-${width}-${colorScheme}.png`) });
    }
  }
});
