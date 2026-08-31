import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, password, registerUser } from "./helpers";

test("settings use one grouped navigation and mount only the active page", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `settings-navigation-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Settings Navigation E2E");
  await authenticatePage(page, auth.token);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Pages in this settings section" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Date & time", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search settings" })).toHaveCount(0);
  await expect(page.getByText("Media cleanup", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Organization" })).toHaveCount(0);

  expect(consoleErrors).toEqual([]);

  await page.goto(`/settings?tab=ownership&workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Ownership", level: 1 })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Delete Organization" })).toBeVisible();

  expect(consoleErrors).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(consoleErrors).toEqual([]);
});

test("workspace repost rules save thresholds, delays, and cross-workspace targets", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `repost-settings-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Repost Settings E2E");
  await authenticatePage(page, auth.token);

  let savedPolicies: Array<Record<string, unknown>> = [];
  const accounts = [
    {
      id: "x-main",
      workspace_id: workspace.id,
      workspace_name: "Repost Settings E2E",
      platform: "x",
      username: "main",
      supports_repost: true,
      cross_workspace: false,
      grant_required: false,
      grant_active: true,
    },
    {
      id: "x-client",
      workspace_id: "workspace-client",
      workspace_name: "Client",
      platform: "x",
      username: "client",
      supports_repost: true,
      cross_workspace: true,
      grant_required: true,
      grant_active: false,
    },
  ];
  await page.route("**/api/v1/repost-automation*", async (route) => {
    if (route.request().method() === "PUT") {
      savedPolicies = route.request().postDataJSON().policies;
      await route.fulfill({
        contentType: "application/json",
        json: {
          workspace_id: workspace.id,
          can_manage: true,
          supported_platforms: ["x", "mastodon", "bluesky", "linkedin"],
          policies: savedPolicies.map((policy) => ({
            ...policy,
            created_at: "2026-08-04T12:00:00Z",
            updated_at: "2026-08-04T12:00:00Z",
          })),
          accounts: accounts.map((account) =>
            account.id === "x-client"
              ? { ...account, grant_required: false, grant_active: true }
              : account,
          ),
          grants: [],
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        workspace_id: workspace.id,
        can_manage: true,
        supported_platforms: ["x", "mastodon", "bluesky", "linkedin"],
        policies: [],
        accounts,
        grants: [],
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/settings?tab=reposts&workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Automatic reposting" })).toBeVisible();
  await expect(page.getByText("A post is never copied to a different network.")).toBeVisible();

  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule name").fill("High-signal launch posts");
  await page.getByText("@client", { exact: true }).click();
  await page.getByLabel("Minimum likes").fill("25");
  await page.getByLabel("Delay", { exact: true }).click();
  await page.getByRole("option", { name: "6 hr" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Repost settings saved.")).toBeVisible();
  expect(savedPolicies).toHaveLength(1);
  expect(savedPolicies[0]).toMatchObject({
    name: "High-signal launch posts",
    target_account_ids: ["x-main", "x-client"],
    rule: {
      delay_seconds: 21600,
      min_likes: 25,
      threshold_mode: "all",
    },
  });

  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByLabel("Rule name")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(consoleErrors).toEqual([]);
});

test("account OAuth errors stay in Settings with bounded feedback", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `oauth-error-${unique}@example.com`);
  await createWorkspace(request, auth.token, "OAuth Settings");
  await authenticatePage(page, auth.token);

  await page.goto("/settings?tab=accounts&error=access_denied%3A+Nope");

  await expect(page).toHaveURL(/\/settings\?tab=accounts$/);
  await expect(
    page.getByText(
      "OpenPost could not connect that destination. Check the provider setup and try again.",
    ),
  ).toBeVisible();
});

test("workspace settings delete the active workspace and keep another", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `workspace-delete-${unique}@example.com`);
  const doomed = await createWorkspace(request, auth.token, "Doomed Workspace");
  const keeperResponse = await request.post("/api/v1/workspaces", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: "Keeper Workspace", organization_id: doomed.organization_id },
  });
  expect(keeperResponse.ok()).toBeTruthy();
  const keeper = await keeperResponse.json();
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=general&workspace=${doomed.id}`);

  const renameResponse = await request.patch(`/api/v1/workspaces/${doomed.id}/settings`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: "Canonical Workspace" },
  });
  expect(renameResponse.ok()).toBeTruthy();

  await page.getByText("Danger zone", { exact: true }).click();
  await page.getByRole("button", { name: "Delete workspace" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Delete this workspace?" })).toBeVisible();
  await expect(dialog.getByText("Removed permanently")).toBeVisible();
  await expect(dialog.getByText("Retained records")).toBeVisible();
  await expect(
    dialog.getByText("This Workspace cannot be recovered after deletion."),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await dialog.getByLabel("Enter Canonical Workspace exactly").fill("Canonical Workspace");
  await dialog.getByLabel("Current password").fill("wrong-password");
  await dialog.getByRole("button", { name: "Delete workspace" }).click();
  await expect(dialog.getByText("recent reauthentication is required")).toBeVisible();
  await expect(dialog.getByLabel("Enter Canonical Workspace exactly")).toHaveValue(
    "Canonical Workspace",
  );
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(doomed.id);

  const retainedAfterFailure = await request.get(`/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(
    (await retainedAfterFailure.json()).map((workspace: { id: string }) => workspace.id),
  ).toContain(doomed.id);

  await dialog.getByLabel("Current password").fill(password);
  await dialog.getByRole("button", { name: "Delete workspace" }).click();

  await expect(page).toHaveURL(/\/$/);

  const workspaces = await request.get(`/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(workspaces.ok()).toBeTruthy();
  const body = await workspaces.json();
  expect(body.map((workspace: { id: string }) => workspace.id)).toContain(keeper.id);
  expect(body.map((workspace: { id: string }) => workspace.id)).not.toContain(doomed.id);
});

test("Organization Owner reviews and permanently deletes the complete Organization", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `organization-delete-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Organization Deletion E2E");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=ownership&workspace=${workspace.id}`);

  await page.getByRole("button", { name: "Delete Organization" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Delete this Organization?" })).toBeVisible();
  await expect(dialog.getByText("Organization Deletion E2E", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Billing state: No subscription")).toBeVisible();
  await expect(dialog.getByText("Provider writes: 0")).toBeVisible();
  await expect(dialog.getByText("Other external jobs: 0")).toBeVisible();
  await expect(dialog.getByText("Cleanup jobs: 0")).toBeVisible();
  await expect(dialog.getByText("Access removed")).toBeVisible();
  await expect(dialog.getByText("Organization membership for every member")).toBeVisible();
  await expect(
    dialog.getByText("Publications, drafts, schedules, analytics, and messages"),
  ).toBeVisible();
  await expect(
    dialog.getByText("Minimum audit evidence without deleted content or credentials"),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
  await expect(dialog.getByText(/cannot be recovered/)).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog
    .getByLabel("Enter Organization Deletion E2E exactly")
    .fill("Organization Deletion E2E");
  await dialog.getByLabel("Current password").fill("wrong-password");
  const rejectedDeletion = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/api/v1/organizations/${workspace.organization_id}`),
  );
  await dialog.getByRole("button", { name: "Delete Organization" }).click();
  expect((await rejectedDeletion).status()).toBe(401);
  await expect(dialog.getByText("recent reauthentication is required")).toBeVisible();
  expect(consoleErrors).toEqual([
    "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
  ]);
  consoleErrors.length = 0;
  await dialog.getByLabel("Current password").fill(password);
  await dialog.getByRole("button", { name: "Delete Organization" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const organizations = await request.get("/api/v1/organizations", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(organizations.ok()).toBeTruthy();
  expect((await organizations.json()).map((item: { id: string }) => item.id)).not.toContain(
    workspace.organization_id,
  );
  expect(consoleErrors).toEqual([]);
});

test("workspace settings warn before leaving and save the shared workspace color", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `workspace-settings-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Workspace Settings E2E");
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

  await page.getByRole("button", { name: "Workspace color" }).click();
  await page.getByLabel("Hex color").fill("#2563EB");
  await page.getByLabel("Hex color").press("Enter");

  const warning = page.waitForEvent("dialog");
  const attemptedNavigation = page.getByRole("button", { name: "Calendar", exact: true }).click();
  const dialog = await warning;
  expect(dialog.message()).toContain("unsaved settings");
  await dialog.dismiss();
  await attemptedNavigation;
  await expect(page).toHaveURL(/\/settings\?tab=general/);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved successfully")).toBeVisible();

  const response = await request.get(`/api/v1/workspaces/${workspace.id}/settings`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).color).toBe("#2563eb");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar/);
});

test("instance admins configure optional services and provider apps without exposing secrets", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const unique = Date.now().toString(36);
  const auth = await registerUser(request, "instance-configuration-" + unique + "@example.com");
  await createWorkspace(request, auth.token, "Instance Configuration E2E");
  const meResponse = await request.get("/api/v1/auth/me", {
    headers: { Authorization: "Bearer " + auth.token },
  });
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  let savedSettings: Array<{ key: string; value?: string; unset?: boolean }> = [];
  let failInitialSettingsLoad = true;
  const settings = [
    {
      key: "OPENPOST_DISABLE_REGISTRATIONS",
      group: "accounts",
      label: "Disable new registrations",
      description: "Stop new registrations.",
      type: "boolean",
      secret: false,
      optional: false,
      environment_variables: ["OPENPOST_DISABLE_REGISTRATIONS"],
      value: "false",
      source: "environment",
      managed_by: "OPENPOST_DISABLE_REGISTRATIONS",
      configured: true,
      secret_configured: false,
      database_override_configured: false,
      editable: true,
      requires_restart: false,
    },
    {
      key: "OPENPOST_EMAIL_VERIFICATION_REQUIRED",
      group: "email",
      label: "Require email verification",
      description: "Require a six-digit code.",
      type: "boolean",
      secret: false,
      optional: false,
      environment_variables: ["OPENPOST_EMAIL_VERIFICATION_REQUIRED"],
      value: "false",
      source: "default",
      configured: true,
      secret_configured: false,
      database_override_configured: false,
      editable: true,
      requires_restart: false,
    },
    {
      key: "OPENPOST_RESEND_API_KEY",
      group: "email",
      label: "Resend API key",
      description: "Write-only delivery key.",
      type: "secret",
      secret: true,
      optional: true,
      environment_variables: ["OPENPOST_RESEND_API_KEY"],
      source: "database",
      configured: true,
      secret_configured: true,
      database_override_configured: true,
      editable: true,
      requires_restart: false,
    },
  ];

  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { ...me, is_admin: true },
    });
  });
  await page.route("**/api/v1/admin/instance-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      savedSettings = body.settings;
      await route.fulfill({
        contentType: "application/json",
        json: {
          settings: settings.map((setting) => {
            if (setting.key === "OPENPOST_EMAIL_VERIFICATION_REQUIRED") {
              return {
                ...setting,
                value: "true",
                source: "database",
                requires_restart: true,
              };
            }
            if (setting.key === "OPENPOST_DISABLE_REGISTRATIONS") {
              return {
                ...setting,
                value: "true",
                source: "database",
                database_override_configured: true,
                requires_restart: true,
              };
            }
            return setting;
          }),
          requires_restart: true,
        },
      });
      return;
    }
    if (failInitialSettingsLoad) {
      failInitialSettingsLoad = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        json: { detail: "Configuration is temporarily unavailable." },
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { settings, requires_restart: false },
    });
  });
  await page.route("**/api/v1/admin/provider-apps", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "environment:x",
          provider: "x",
          client_id: "public-x-client",
          redirect_uri: "https://app.example.com/api/v1/accounts/x/callback",
          is_active: true,
          secret_configured: true,
          created_at: "",
          updated_at: "",
          source: "environment",
          editable: false,
          deletable: false,
          shadowed_by_environment: false,
        },
        {
          id: "database-x-fallback",
          provider: "x",
          client_id: "stored-x-client",
          redirect_uri: "https://old.example.com/api/v1/accounts/x/callback",
          is_active: true,
          secret_configured: true,
          created_at: "2026-08-01T12:00:00Z",
          updated_at: "2026-08-01T12:00:00Z",
          source: "database",
          editable: false,
          deletable: true,
          shadowed_by_environment: true,
        },
      ],
    });
  });

  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/settings?tab=configuration");

  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
  expect(consoleErrors).toEqual([
    "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
  ]);
  consoleErrors.length = 0;
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { name: "Configuration", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Disable new registrations")).toBeEnabled();
  await expect(page.getByText("Environment value set", { exact: true })).toBeVisible();
  await expect(
    page.getByText("OPENPOST_DISABLE_REGISTRATIONS already supplies this setting."),
  ).toBeVisible();
  await page.getByLabel("Disable new registrations").click();
  await expect(page.getByText("Will override the environment value")).toBeVisible();

  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByLabel("Require email verification").click();
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect
    .poll(() => savedSettings)
    .toContainEqual({
      key: "OPENPOST_EMAIL_VERIFICATION_REQUIRED",
      value: "true",
    });
  expect(savedSettings).toContainEqual({
    key: "OPENPOST_DISABLE_REGISTRATIONS",
    value: "true",
  });
  await expect(page.getByText("A server restart is required.")).toBeVisible();
  await page
    .getByTestId("instance-configuration")
    .getByRole("button", { name: "Accounts", exact: true })
    .click();
  await expect(page.getByText("Admin override saved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use environment value" })).toBeVisible();
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.getByLabel("Resend API key")).toHaveValue("");
  await expect(page.getByLabel("Resend API key")).toHaveAttribute(
    "placeholder",
    "A secret is configured",
  );

  await page.getByRole("button", { name: "Provider apps", exact: true }).click();
  await expect(page.getByText("public-x-client")).toBeVisible();
  await expect(page.getByText("stored-x-client")).toBeVisible();
  await expect(page.getByText("Stored fallback")).toBeVisible();
  await expect(page.getByText("Managed by environment")).toBeVisible();
  await expect(page.locator("#provider-app-secret")).toHaveValue("");

  await page.setViewportSize({ width: 375, height: 760 });
  const configuration = page.getByTestId("instance-configuration");
  await expect(configuration).toBeVisible();
  const bounds = await configuration.boundingBox();
  expect(bounds?.width ?? 0).toBeLessThanOrEqual(375);
  expect(consoleErrors).toEqual([]);
});
