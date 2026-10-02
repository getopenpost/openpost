import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`disabled collection offers account recovery at ${width}px ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      const { token } = await registerUser(
        request,
        `engagement-recovery-${randomUUID()}@example.com`,
      );
      const workspace = await createWorkspace(request, token, "Recovery workspace");
      await authenticatePage(page, token);
      const disabledID = randomUUID();
      const retryID = randomUUID();
      await page.route("**/api/v1/accounts?**", (route) =>
        route.fulfill({
          json: [
            {
              id: disabledID,
              workspace_id: workspace.id,
              platform: "discord",
              is_active: true,
              account_username: "Disabled account",
            },
            {
              id: retryID,
              workspace_id: workspace.id,
              platform: "bluesky",
              is_active: true,
              account_username: "Retry account",
            },
          ],
        }),
      );
      await page.route("**/api/v1/account-features?**", (route) =>
        route.fulfill({
          json: [
            { social_account_id: disabledID, feature: "engagement", effective_enabled: false },
            { social_account_id: retryID, feature: "engagement", effective_enabled: true },
          ],
        }),
      );
      const states = [
        {
          id: randomUUID(),
          rendition_id: randomUUID(),
          social_account_id: disabledID,
          platform: "discord",
          status: width === 320 && scheme === "dark" ? "temporarily_unavailable" : "disabled",
          error_code: width === 390 && scheme === "light" ? "" : "feature_disabled",
          error_message: "Engagement is disabled for this account.",
          next_sync_at: "0001-01-01T00:00:00Z",
        },
        {
          id: randomUUID(),
          rendition_id: randomUUID(),
          social_account_id: retryID,
          platform: "bluesky",
          status: "temporarily_unavailable",
          error_code: "provider_temporarily_unavailable",
          error_message: "Provider is temporarily unavailable.",
          next_sync_at: "2030-01-01T00:00:00Z",
        },
      ];
      await page.route("**/api/v1/engagement?**", (route) =>
        route.fulfill({ json: { items: [], total: 0, sync_states: states } }),
      );
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/inbox/engagement");
      const trigger = page.getByRole("button", { name: "Collection issues (2)", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const popup = page.locator('[data-slot="popover-content"]');
      await expect(popup.getByText("Comments and replies are off", { exact: true })).toBeVisible();
      await expect(
        popup.getByText("OpenPost will retry collection for 1 posts.", { exact: true }),
      ).toHaveCount(1);
      await expect(
        popup.getByRole("button", { name: "Refresh engagement", exact: true }),
      ).toHaveCount(1);
      const details = popup.getByRole("link", { name: "Open account details", exact: true });
      await expect(details).toHaveAttribute("href", "/settings?tab=accounts");
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`recovery-${width}-${scheme}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
