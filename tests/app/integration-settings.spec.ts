import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1440, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Discord settings keep required feedback usable at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      const { token } = await registerUser(request, `bot-settings-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, token, "Integration settings");
      const accountID = randomUUID();
      const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        databasePath,
        `INSERT INTO social_accounts
        (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted,
         capability_state_json, is_active)
        VALUES ('${accountID}', '${workspace.id}', 'discord-test', 'discord', 'guild-test',
        'Test server', X'00', '{"connection_type":"bot"}', 1);`,
      ]);
      const created = await request.post("/api/v1/publications", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          workspace_id: workspace.id,
          title: "Integration settings check",
          source_text: "A clearly labelled local test draft.",
          content_profile: "short_text",
          social_account_ids: [accountID],
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const publication = await created.json();
      await page.route(`**/api/v1/accounts/${accountID}/publishing-options/**`, (route) =>
        route.fulfill({
          json: {
            options: [
              { value: "channel-test", label: "#test-posts" },
              { value: "channel-updates", label: "#updates" },
            ],
          },
        }),
      );
      await authenticatePage(page, token);
      await page.addInitScript((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/publications/${publication.id}`);
      await page.getByRole("tab", { name: /^Test server/ }).click();
      await page.getByRole("button", { name: "Platform settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Discord settings", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(page.locator("[data-sonner-toast]")).toContainText("Channel");
      await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
      await expect(
        page.locator(
          "[data-sonner-toaster][data-y-position=top][data-x-position=right] [data-sonner-toast]",
        ),
      ).toBeVisible();
      await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toBeFocused();
      const toastBounds = await page.locator("[data-sonner-toast]").boundingBox();
      expect(toastBounds!.x).toBeGreaterThanOrEqual(0);
      expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual(width);
      if (width < 600) {
        const closeBounds = await dialog
          .getByRole("button", { name: "Close", exact: true })
          .boundingBox();
        expect(toastBounds!.y).toBeGreaterThanOrEqual(closeBounds!.y + closeBounds!.height);
      }
      const requiredAccessibility = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .include("[data-sonner-toast]")
        .analyze();
      expect(requiredAccessibility.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`required-channel-${width}-${scheme}.png`),
        animations: "disabled",
      });
      await dialog
        .getByRole("button", { name: "Close", exact: true })
        .click({ trial: true, timeout: 1500 });
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
      await page.getByRole("option", { name: "#test-posts", exact: true }).click();
      await dialog.getByRole("button", { name: "Add embed", exact: true }).click();
      await dialog.getByLabel("Title", { exact: true }).fill("Launch notes");
      await dialog.getByLabel("Description", { exact: true }).fill("A structured embed preview.");
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`embed-${width}-${scheme}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(dialog).not.toBeVisible();

      await page.getByTestId("composer-account-control").click();
      await page.getByRole("button", { name: "Manage Social Sets", exact: true }).click();
      const manager = page.getByRole("dialog", { name: "Manage Social Sets", exact: true });
      await manager.getByRole("textbox", { name: "Set name", exact: true }).fill("Launch updates");
      await manager.getByLabel("Format for Test server", { exact: true }).click();
      await page.getByRole("option", { name: "Discord message", exact: true }).click();
      await manager.getByRole("button", { name: "Edit post settings", exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
      await page.getByRole("option", { name: "#test-posts", exact: true }).click();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/social-sets") && response.request().method() === "POST",
      );
      await manager.getByRole("button", { name: "Save", exact: true }).click();
      const savedResponse = await saved;
      expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
      const socialSet = await savedResponse.json();
      expect(socialSet.accounts[0].default_settings).toEqual({ channel_id: "channel-test" });
      await expect(manager.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath(`social-set-${width}-${scheme}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(manager).not.toBeVisible();
      await page.getByTestId("composer-account-control").click();
      await page.getByRole("button", { name: "Manage Social Sets", exact: true }).click();
      await manager.getByRole("button", { name: "Edit post settings", exact: true }).click();
      await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toContainText(
        "#test-posts",
      );
      await dialog.getByRole("combobox", { name: "Channel", exact: true }).click();
      await page.getByRole("option", { name: "#updates", exact: true }).click();
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      const updated = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/social-sets/${socialSet.id}`) &&
          response.request().method() === "PUT",
      );
      await manager.getByRole("button", { name: "Save", exact: true }).click();
      const updatedResponse = await updated;
      expect(updatedResponse.ok(), await updatedResponse.text()).toBe(true);
      expect((await updatedResponse.json()).accounts[0].default_settings).toEqual({
        channel_id: "channel-updates",
      });
      await expect(manager.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(manager).not.toBeVisible();
      await page.goto("/");
      await expect(page.getByTestId("composer-account-control")).toContainText("Launch updates");
      await page.getByRole("tab", { name: /^Test server/ }).click();
      await page.getByRole("button", { name: "Platform settings", exact: true }).click();
      await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toContainText(
        "#updates",
      );
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    });
  }
}
