import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("disconnected local projects explain how to reach project bundle import", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `bundle-discovery-${Date.now()}@example.com`);
  await createWorkspace(request, auth.token, "Bundle discovery");
  await authenticatePage(page, auth.token);
  await page.goto("/video-editor");
  const local = page.getByRole("region", { name: "Local only", exact: true });
  await expect(local).toBeVisible();
  await expect(local.getByRole("button", { name: "Import bundle", exact: true })).toBeVisible();
  await expect(local.getByRole("button", { name: "Import bundle", exact: true })).toBeDisabled();
  await expect(
    local.getByText("Project bundle imports require a connected local folder.", { exact: true }),
  ).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((mode) => localStorage.setItem("mode-watcher-mode", mode), scheme);
    await page.reload();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const button = local.getByRole("button", { name: "Import bundle", exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeDisabled();
      await expect(
        local.getByText("Project bundle imports require a connected local folder.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.screenshot({ path: `test-results/l003-${scheme}-${width}.png` });
    }
  }
});
