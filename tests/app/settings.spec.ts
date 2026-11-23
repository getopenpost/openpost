import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  expect as baseExpect,
} from "@playwright/test";
import {
  authenticatePage,
  composerDestinations,
  createWorkspace,
  openComposerPlatformSettings,
  registerUser,
  assignBuiltInTheme,
} from "./helpers";
import { readFile } from "node:fs/promises";

test.describe("integration settings", () => {
  async function openDiscordPublication(
    page: Page,
    request: APIRequestContext,
    width: number,
    scheme: "light" | "dark",
  ) {
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
    await page.goto(`/publications/${publication.id}`);
  }

  test(`Discord Social Set defaults persist at 1440px in light`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDiscordPublication(page, request, 1440, "light");
    const dialog = page.getByRole("dialog", { name: "Discord settings", exact: true });
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
    await composerDestinations(page)
      .getByRole("tab", { name: /^Test server/ })
      .click();
    await openComposerPlatformSettings(page);
    await expect(dialog.getByRole("combobox", { name: "Channel", exact: true })).toContainText(
      "#updates",
    );
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    expect(errors).toEqual([]);
  });
});

test.describe("workspace settings", () => {
  test("workspace timezone and required client review survive a reload", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workspace-review-${Date.now()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Canadian workspace");
    await authenticatePage(page, auth.token);
    await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

    const timezone = page.getByRole("button", { name: "Timezone", exact: true });
    const review = page.getByRole("checkbox", { name: "Require client review for every post" });
    const save = page.getByRole("button", { name: "Save changes", exact: true });
    for (const zone of [
      { id: "America/Halifax", label: /Halifax \(Atlantic Time\)/ },
      { id: "America/St_Johns", label: /St Johns \(Newfoundland Time\)/ },
    ]) {
      await timezone.click();
      await page.getByRole("option", { name: zone.label }).click();
      await review.setChecked(true);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
      );
      await save.click();
      expect((await saved).ok()).toBeTruthy();
      await page.reload();
      await expect(timezone).toHaveText(zone.label);
      await expect(review).toBeChecked();
      const settings = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      expect(settings.ok()).toBeTruthy();
      expect(await settings.json()).toMatchObject({
        timezone: zone.id,
        require_client_review: true,
      });
    }

    await review.uncheck();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/api/v1/workspaces/${workspace.id}/settings`),
    );
    await save.click();
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await expect(review).not.toBeChecked();
  });
});

test.describe("app branding", () => {
  const expect = baseExpect.configure({ timeout: 20000 });

  test("organization branding saves, previews, reloads and stays separate from public entry identity", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { token } = await registerUser(request, `branding-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Branding studio");
    await authenticatePage(page, token);
    await page.goto("/settings?tab=appearance");
    await page.getByRole("tab", { name: "App branding", exact: true }).click();
    await expect(page.getByLabel("App display name", { exact: true })).toHaveValue("OpenPost");
    await page.getByLabel("App display name", { exact: true }).fill("Studio Social");
    await page.getByLabel("Square logo", { exact: true }).setInputFiles({
      name: "studio.png",
      mimeType: "image/png",
      buffer: await readFile("assets/brand/apple-touch-icon.png"),
    });
    await page.getByLabel("Allow workspace branding overrides", { exact: true }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("App branding saved.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
    // The calm sidebar shows the logo only; the brand name lives in the
    // accessible name and the document title.
    await expect(page).toHaveTitle("Settings - Studio Social");
    const logo = page.getByTestId("sidebar-home-brand").locator("img");
    await expect(logo).toBeVisible();
    const logoURL = await logo.getAttribute("src");
    expect(logoURL).toContain("/app-branding/");
    await assignBuiltInTheme(request, token, workspace.id, "workshop");
    await page.reload();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
    await page.goto("/settings?tab=app-branding");
    await expect(page.getByText("Using organization branding.", { exact: false })).toBeVisible();
    await page.getByLabel("App display name", { exact: true }).fill("Client Social");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName("Client Social home");
    await page.getByRole("button", { name: "Use organization branding", exact: true }).click();
    await expect(page.getByTestId("sidebar-home-brand")).toHaveAccessibleName(
      "Studio Social home",
      {
        timeout: 20000,
      },
    );
    await page.goto("/draft-import");
    await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
      "href",
      /\/assets\/brand\/icon\.svg$/,
    );
    await expect(page).not.toHaveTitle(/Studio Social/);
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
      "href",
      /\/assets\/brand\/icon\.svg$/,
    );
    await expect(page.getByText("Studio Social", { exact: true })).toHaveCount(0);
  });
});

test.describe("post imports", () => {
  test.use({ hasTouch: true });

  // A connected account and a stored external post keep this acceptance flow
  // independent of real provider credentials. Setting changes use the real API.
  test("account details expose new-provider imports and keep X disabled", async ({
    page,
    request,
  }) => {
    const { token } = await registerUser(request, `post-imports-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, token, "Imports acceptance");
    const accountID = randomUUID();
    const xID = randomUUID();
    const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    const sql = (statement: string) =>
      execFileSync("sqlite3", ["-cmd", ".timeout 5000", database, statement]);
    sql(`INSERT INTO social_accounts (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted, granted_scopes, is_active, created_at)
      VALUES ('${accountID}', '${workspace.id}', 'threads-imports', 'threads', '42', 'imports-owner', X'00', 'threads_basic', 1, datetime('now')),
      ('${xID}', '${workspace.id}', 'x-imports', 'x', '43', 'x-owner', X'00', '', 1, datetime('now'));`);
    await authenticatePage(page, token);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings?tab=accounts");
    const openDetails = async (id: string) => {
      await page.getByTestId(`account-card-${id}`).getByRole("button").click();
      await page.getByRole("menuitem", { name: "Account details", exact: true }).click();
    };
    await openDetails(accountID);
    const drawer = page.getByTestId("account-settings-drawer");
    const imports = drawer.getByRole("region", { name: "Imported posts" });
    await expect(imports).toBeVisible();
    const enable = imports.getByRole("button", { name: "Turn on", exact: true });
    await expect(enable).toBeEnabled();
    await enable.focus();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/${accountID}/post-imports`),
    );
    await page.keyboard.press("Enter");
    expect((await saved).status()).toBe(200);
    await expect(imports.getByRole("button", { name: "Turn off", exact: true })).toBeEnabled();
    sql(`INSERT INTO imported_posts (id, workspace_id, social_account_id, platform, provider_post_id, title, text, external_url, published_at, origin, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES ('${randomUUID()}', '${workspace.id}', '${accountID}', 'threads', 'native-new', '', 'A launch written directly on Threads.', 'https://www.threads.net/@imports-owner/post/native-new', datetime('now'), 'external', datetime('now'), datetime('now'), datetime('now'), datetime('now'));`);
    await page.keyboard.press("Escape");
    await page.reload();
    await openDetails(accountID);
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await imports.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await openDetails(accountID);
    await expect(
      imports.getByRole("link", { name: "A launch written directly on Threads." }),
    ).toBeVisible();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const toggle = imports.getByRole("button", { name: "Turn on", exact: true });
    const bounds = await toggle.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await openDetails(xID);
    await expect(
      imports.getByText("X imports are disabled by the provider read-cost policy."),
    ).toBeVisible();
    await expect(imports.getByRole("button", { name: "Turn on", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  });
});
