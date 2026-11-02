import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`mark all matching read at ${width}px ${scheme}`, async ({ page, request }, testInfo) => {
      const { token } = await registerUser(request, `bulk-read-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Bulk read workspace");
      await authenticatePage(page, token);
      let read = false;
      let attempts = 0;
      await page.route("**/api/v1/accounts?**", (route) => route.fulfill({ json: [] }));
      await page.route("**/api/v1/account-features?**", (route) => route.fulfill({ json: [] }));
      await page.route("**/api/v1/engagement?**", (route) =>
        route.fulfill({ json: { items: [], total: read ? 0 : 137, sync_states: [] } }),
      );
      await page.route("**/api/v1/engagement/read", async (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          workspace_id: workspace.id,
          archived: true,
        });
        attempts++;
        if (attempts === 1) return route.fulfill({ status: 503, json: { detail: "Unavailable" } });
        read = true;
        return route.fulfill({ json: { updated_count: 137 } });
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/inbox/engagement");
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
      await page.keyboard.press("Escape");
      const button = page.getByRole("button", { name: "Mark all matching read", exact: true });
      await expect(button).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`before-${width}-${scheme}.png`),
        animations: "disabled",
      });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("OpenPost could not start that action.")).toBeVisible();
      await expect(button).toBeEnabled();
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Marked 137 matching items as read.")).toBeVisible();
      await expect(button).toBeEnabled();
      expect(attempts).toBe(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`after-${width}-${scheme}.png`),
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
  }
}
