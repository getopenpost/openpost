import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`synced text stays above customization controls at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const auth = await registerUser(
        request,
        `synced-layout-${width}-${scheme}-${Date.now()}@example.com`,
      );
      const workspace = await createWorkspace(request, auth.token, "Composer layout");
      await authenticatePage(page, auth.token);
      await page.route("**/api/v1/accounts?**", (route) =>
        route.fulfill({
          json: [
            {
              id: "layout-account",
              workspace_id: workspace.id,
              platform: "linkedin",
              account_id: "layout-account",
              account_name: "Rodrigo",
              account_username: "rodrigo",
              is_active: true,
            },
          ],
        }),
      );
      await page.route("**/api/v1/capabilities/resolve", (route) =>
        route.fulfill({
          json: {
            accounts: [
              {
                account_id: "layout-account",
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
      await page.locator("#composer-destination-layout-account").click();
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
    });
  }
}
