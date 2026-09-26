import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`synced text and live previews stay usable at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const auth = await registerUser(
        request,
        `synced-layout-${width}-${scheme}-${randomUUID()}@example.com`,
      );
      const workspace = await createWorkspace(request, auth.token, "Composer layout");
      await authenticatePage(page, auth.token);
      const accountID = randomUUID();
      const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        databasePath,
        `INSERT INTO social_accounts
        (id, workspace_id, slug, platform, account_id, account_username,
         access_token_encrypted, is_active)
        VALUES ('${accountID}', '${workspace.id}', 'preview-${accountID}', 'linkedin',
        '${accountID}', 'Rodrigo', X'00', 1);`,
      ]);
      await page.route("**/api/v1/capabilities/resolve", (route) =>
        route.fulfill({
          json: {
            accounts: [
              {
                account_id: accountID,
                provider: "linkedin",
                profile: "short_text",
                output_profile: "linkedin.post",
                label: "LinkedIn post",
                text_limit: 3000,
                media: {
                  min_count: 0,
                  max_count: 9,
                  allowed_mimes: [],
                  requires_public_url: false,
                  requires_https_fetchable: false,
                },
                intents: ["post"],
                media_shapes: ["text"],
                settings: [],
                setting_groups: [],
                compatible: true,
                active_constraints: {},
                issues: [],
                capability_revision: "test-v1",
                dynamic_options: {},
                immediate_readiness: { state: "healthy", publishable: true },
                scheduled_readiness: { state: "healthy", publishable: true },
              },
            ],
          },
        }),
      );
      await page.goto("/");
      const editor = page.getByRole("textbox", {
        name: "Post text",
        exact: true,
      });
      const text =
        "A longer update that wraps onto multiple lines in the composer.\n\nThe same text is shared across destinations.\n\nThe final line must stay readable above the customization controls.";
      await editor.fill(text);
      await page.locator(`#composer-destination-${accountID}`).click();
      await expect(editor).toBeDisabled();
      await expect(editor).toHaveValue(text);
      const customize = page.getByRole("button", {
        name: "Customize this version",
        exact: true,
      });
      await expect(customize).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("synced.png"),
        fullPage: true,
      });
      const notice = customize.locator("../..");
      const editorBounds = await editor.boundingBox();
      const noticeBounds = await notice.boundingBox();
      expect(noticeBounds!.y).toBeGreaterThanOrEqual(editorBounds!.y + editorBounds!.height);
      expect(noticeBounds!.x).toBeGreaterThanOrEqual(0);
      expect(noticeBounds!.x + noticeBounds!.width).toBeLessThanOrEqual(width);
      await customize.focus();
      await page.keyboard.press("Enter");
      await expect(editor).toBeEnabled();
      await expect(editor).toHaveValue(text);
      await expect(customize).toHaveCount(0);

      const previewButton = page.getByRole("button", { name: "Preview", exact: true });
      await previewButton.focus();
      await page.keyboard.press("Enter");
      await expect(previewButton).toHaveAttribute("aria-expanded", "true");
      const preview = page.getByRole("region", { name: "Preview", exact: true });
      await expect(preview.getByText(text, { exact: true })).toBeVisible();
      const revised = "This destination now has its own edited text.";
      await editor.fill(revised);
      await expect(preview.getByText(revised, { exact: true })).toBeVisible();
      await expect(preview.getByText(text, { exact: true })).toHaveCount(0);
      await preview.screenshot({ path: testInfo.outputPath("compact-preview.png") });

      const popupPromise = page.waitForEvent("popup");
      await preview.getByRole("button", { name: "Full page", exact: true }).click();
      const popup = await popupPromise;
      popup.on("pageerror", (error) => pageErrors.push(error.message));
      popup.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
      });
      await popup.setViewportSize({ width, height: 1000 });
      await popup.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(popup.getByText(revised, { exact: true })).toBeVisible();
      await popup.getByRole("button", { name: "320px", exact: true }).click();
      const fullPreview = popup.getByLabel("LinkedIn page preview", { exact: true });
      await expect(fullPreview).toHaveCSS("width", "320px");
      await popup.getByRole("button", { name: "Dark", exact: true }).click();
      await expect(popup.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const finalText = "The open full-page preview also follows my edits.";
      await editor.fill(finalText);
      await expect(preview.getByText(finalText, { exact: true })).toBeVisible();
      await expect(fullPreview.getByText(finalText, { exact: true })).toBeVisible();
      await fullPreview.screenshot({ path: testInfo.outputPath("full-preview.png") });
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await popup.close();
      expect(pageErrors).toEqual([]);
    });
  }
}
