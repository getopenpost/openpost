import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

function capability(accountId: string, platform: string, profile: string, label: string) {
  return {
    account_id: accountId,
    provider: platform,
    profile,
    output_profile: `${platform}.post`,
    label,
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
  };
}

for (const width of [1280, 390]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`customized destination tab carries its own marker at ${width}px in ${scheme}`, async ({
      page,
      request,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const auth = await registerUser(
        request,
        `variant-tab-${width}-${scheme}-${randomUUID()}@example.com`,
      );
      const workspace = await createWorkspace(request, auth.token, "Variant tabs");
      await authenticatePage(page, auth.token);
      await page.route("**/api/v1/accounts?**", (route) =>
        route.fulfill({
          json: [
            {
              id: "variant-first",
              workspace_id: workspace.id,
              platform: "x",
              account_id: "variant-first",
              account_name: "First",
              account_username: "first",
              is_active: true,
            },
            {
              id: "variant-second",
              workspace_id: workspace.id,
              platform: "threads",
              account_id: "variant-second",
              account_name: "Second",
              account_username: "second",
              is_active: true,
            },
          ],
        }),
      );
      await page.route("**/api/v1/capabilities/resolve", (route) =>
        route.fulfill({
          json: {
            accounts: [
              capability("variant-first", "x", "short_text", "X post"),
              capability("variant-second", "threads", "short_text", "Threads post"),
            ],
          },
        }),
      );
      await page.goto("/");
      const editor = page.getByRole("textbox", {
        name: "Post text",
        exact: true,
      });
      await editor.fill("Shared launch update for every destination.");

      const firstTab = page.locator("#composer-destination-variant-first");
      const secondTab = page.locator("#composer-destination-variant-second");
      await expect(firstTab.getByTestId("composer-destination-custom")).toHaveCount(0);
      await expect(secondTab.getByTestId("composer-destination-custom")).toHaveCount(0);

      await firstTab.click();
      await page.getByRole("button", { name: "Customize this version", exact: true }).click();
      await expect(editor).toBeEnabled();

      await expect(firstTab.getByTestId("composer-destination-custom")).toBeVisible();
      await expect(secondTab.getByTestId("composer-destination-custom")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: /custom/ })).toBeVisible();

      const tabs = page.getByRole("tablist", { name: "Destinations" });
      await tabs.screenshot({ path: testInfo.outputPath("variant-tabs.png") });
    });
  }
}
