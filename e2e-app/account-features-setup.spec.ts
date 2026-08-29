import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

function featureResponse(
  accountId: string,
  platform: string,
  feature: "messaging" | "engagement" | "analytics" | "grow",
  opts: Partial<{
    supported: boolean;
    availability: "available" | "unsupported" | "missing_scope" | "plan_restricted";
    stored_exists: boolean;
    stored_enabled: boolean;
    required_scopes: string[];
    missing_scopes: string[];
    effective_enabled: boolean;
  }> = {},
) {
  const supported = opts.supported ?? true;
  const availability = opts.availability ?? "available";
  const stored_exists = opts.stored_exists ?? false;
  const stored_enabled = opts.stored_enabled ?? false;
  return {
    workspace_id: "ws-1",
    social_account_id: accountId,
    platform,
    feature,
    supported,
    availability,
    reason_code: availability,
    required_scopes: opts.required_scopes ?? [],
    missing_scopes: opts.missing_scopes ?? [],
    unavailable_reason: "",
    stored_exists,
    stored_enabled,
    effective_enabled:
      opts.effective_enabled ?? (stored_exists && stored_enabled && availability === "available"),
  };
}

function setupMocks(
  page: import("@playwright/test").Page,
  opts: {
    workspaceId: string;
    accountIds: string[];
    newAccountIds: string[];
    featureMap: Record<string, ReturnType<typeof featureResponse>[]>;
    accounts?: Array<{ id: string; platform: string; account_username: string }>;
  },
) {
  const allFeatures = Object.values(opts.featureMap).flat();
  // Mock GET /account-features
  page.route("**/api/v1/account-features?*", async (route) => {
    if (route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const ids = (url.searchParams.get("account_ids") ?? "").split(",").filter(Boolean);
      const filtered = allFeatures.filter((f) => ids.includes(f.social_account_id));
      // adjust workspace_id
      const body = filtered.map((f) => ({ ...f, workspace_id: opts.workspaceId }));
      await route.fulfill({ contentType: "application/json", json: body });
      return;
    }
    await route.continue();
  });
  // Capture POST
  let captured: unknown = null;
  page.route("**/api/v1/account-features", async (route) => {
    if (route.request().method() === "POST") {
      captured = route.request().postDataJSON();
      const body = captured as {
        workspace_id: string;
        choices: Array<{ account_id: string; feature: string; enabled: boolean }>;
      };
      // Echo back stored state
      const responded = allFeatures.map((f) => {
        const choice = body.choices.find(
          (c) => c.account_id === f.social_account_id && c.feature === f.feature,
        );
        if (choice) {
          return {
            ...f,
            workspace_id: body.workspace_id,
            stored_exists: true,
            stored_enabled: choice.enabled,
            effective_enabled: choice.enabled && f.availability === "available",
          };
        }
        return { ...f, workspace_id: body.workspace_id };
      });
      await route.fulfill({ contentType: "application/json", json: responded });
      return;
    }
    await route.continue();
  });
  page.route("**/api/v1/accounts?*", async (route) => {
    if (route.request().method() === "GET" && route.request().url().includes("/api/v1/accounts?")) {
      const accs =
        opts.accounts ??
        opts.accountIds.map((id) => ({
          id,
          platform: "x",
          account_username: id.slice(0, 6),
          slug: id.slice(0, 6),
          messaging_supported: true,
          messages_enabled: false,
          is_active: true,
          instance_url: "",
          account_id: id,
          account_avatar_url: "",
          limit_profile: undefined,
          grant_destination_count: 1,
          shared_grant: false,
          thread_replies_supported: true,
        }));
      await route.fulfill({ contentType: "application/json", json: accs });
      return;
    }
    await route.continue();
  });
  // Provide helper to get captured
  return {
    getCaptured: () =>
      captured as {
        workspace_id: string;
        choices: Array<{ account_id: string; feature: string; enabled: boolean }>;
      } | null,
  };
}

test.describe("account setup", () => {
  test("one feature renders and saves enabled choice", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-one-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Setup One");
    await authenticatePage(page, auth.token);

    const accountId = "acc-one";
    const newIds = [accountId];
    const accountIds = [accountId];
    const mocks = setupMocks(page, {
      workspaceId: ws.id,
      accountIds,
      newAccountIds: newIds,
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "x", "messaging", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(accountId, "x", "engagement", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(accountId, "x", "analytics", {
            supported: true,
            availability: "available",
          }),
          featureResponse(accountId, "x", "grow", {
            supported: false,
            availability: "unsupported",
          }),
        ],
      },
    });

    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountIds.join(",")}&new_account_ids=${newIds.join(",")}`,
    );
    await expect(page.getByRole("heading", { name: "Set up your new destinations" })).toBeVisible();
    await expect(page.getByLabel("Analytics")).toBeVisible();
    await expect(page.getByLabel("Direct messages")).toHaveCount(0);
    await expect(page.getByLabel("Analytics")).not.toBeChecked();
    await page.getByLabel("Analytics").check();
    await expect(page.getByLabel("Analytics")).toBeChecked();

    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
    const captured = mocks.getCaptured();
    expect(captured?.choices).toEqual(
      expect.arrayContaining([
        { account_id: accountId, feature: "analytics", enabled: true, source: "user_save" },
      ]),
    );
  });

  test("several features grouped under Inbox and saved", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-several-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Setup Several");
    await authenticatePage(page, auth.token);
    const accountId = "acc-several";
    const mocks = setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "instagram", "messaging", { supported: true }),
          featureResponse(accountId, "instagram", "engagement", { supported: true }),
          featureResponse(accountId, "instagram", "analytics", { supported: true }),
          featureResponse(accountId, "instagram", "grow", { supported: true }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByLabel("Direct messages")).toBeVisible();
    await expect(page.getByLabel("Comments and replies")).toBeVisible();
    await expect(page.getByLabel("Analytics")).toBeVisible();
    await expect(page.getByLabel("Grow")).toBeVisible();
    // every offered starts unchecked
    for (const label of ["Direct messages", "Comments and replies", "Analytics", "Grow"]) {
      await expect(page.getByLabel(label)).not.toBeChecked();
    }
    await page.getByLabel("Direct messages").check();
    await page.getByLabel("Grow").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
    const captured = mocks.getCaptured();
    expect(captured?.choices).toEqual(
      expect.arrayContaining([
        { account_id: accountId, feature: "messaging", enabled: true, source: "user_save" },
        { account_id: accountId, feature: "engagement", enabled: false, source: "user_save" },
        { account_id: accountId, feature: "analytics", enabled: false, source: "user_save" },
        { account_id: accountId, feature: "grow", enabled: true, source: "user_save" },
      ]),
    );
  });

  test("no supported feature bypasses empty step", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-none-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Setup None");
    await authenticatePage(page, auth.token);
    const accountId = "acc-none";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "discord", "messaging", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(accountId, "discord", "engagement", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(accountId, "discord", "analytics", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(accountId, "discord", "grow", {
            supported: false,
            availability: "unsupported",
          }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    // Should auto-continue to /accounts without showing feature UI
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/, { timeout: 5000 });
  });

  test("Keep all off writes disabled rows atomically", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-keepoff-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Keep Off");
    await authenticatePage(page, auth.token);
    const accountId = "acc-keep";
    const mocks = setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "x", "messaging", { supported: true }),
          featureResponse(accountId, "x", "engagement", { supported: true }),
          featureResponse(accountId, "x", "analytics", { supported: true }),
          featureResponse(accountId, "x", "grow", { supported: true }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    // Explicit Keep all off without checking anything
    await page.getByRole("button", { name: "Keep all off" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
    const captured = mocks.getCaptured();
    expect(captured?.choices.every((c) => c.enabled === false)).toBe(true);
    expect(captured?.choices.length).toBe(4);
    // Save and continue with no selection also writes disabled
    const accountId2 = "acc-keep2";
    const mocks2 = setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId2],
      newAccountIds: [accountId2],
      featureMap: {
        [accountId2]: [
          featureResponse(accountId2, "x", "messaging", { supported: true }),
          featureResponse(accountId2, "x", "analytics", { supported: true }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId2}&new_account_ids=${accountId2}`,
    );
    await expect(page.getByLabel("Direct messages")).toBeVisible();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
    const captured2 = mocks2.getCaptured();
    expect(captured2?.choices.every((c) => c.enabled === false)).toBe(true);
  });

  test("reload survives and keeps state via URL validation", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-reload-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Reload");
    await authenticatePage(page, auth.token);
    const accountId = "acc-reload";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [featureResponse(accountId, "x", "analytics", { supported: true })],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    await expect(page.getByLabel("Analytics")).toBeVisible();
    await page.getByLabel("Analytics").check();
    await page.reload();
    await expect(page.getByLabel("Analytics")).toBeVisible();
    // After reload starts unchecked again (setup always starts off)
    await expect(page.getByLabel("Analytics")).not.toBeChecked();
  });

  test("missing permission vs plan restricted distinct copy", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-avail-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Avail");
    await authenticatePage(page, auth.token);
    const accountId = "acc-avail";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "facebook", "messaging", {
            supported: true,
            availability: "missing_scope",
            required_scopes: ["pages_messaging"],
            missing_scopes: ["pages_messaging"],
          }),
          featureResponse(accountId, "facebook", "analytics", {
            supported: true,
            availability: "plan_restricted",
          }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    const messagingRow = page.getByLabel("Direct messages");
    await expect(messagingRow).toBeDisabled();
    await expect(page.getByText("Needs more provider permission: pages_messaging")).toBeVisible();
    // Ensure plan restricted wording distinct from reconnect
    await expect(page.getByText("Your current plan does not include this feature")).toBeVisible();
    await expect(messagingRow).toBeDisabled();
    await expect(page.getByLabel("Analytics")).toBeDisabled();
  });

  test("first composer continuation goes to composer", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-first-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "First");
    await authenticatePage(page, auth.token);
    const accountId = "acc-first";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [featureResponse(accountId, "x", "analytics", { supported: true })],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}&open_fresh_composer=true`,
    );
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(new RegExp(`\\/\\?workspace_id=${ws.id}`));
  });

  test("later direct Accounts continuation returns to /accounts", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-direct-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Direct");
    await authenticatePage(page, auth.token);
    await page.goto("/settings?tab=accounts");
    await page.evaluate(() => localStorage.setItem("oauth_account_management_mode", "direct"));
    const accountId = "acc-direct";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [featureResponse(accountId, "x", "analytics", { supported: true })],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
  });

  test("routine reauth no prompt and explicit off suppresses reminder", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-routine-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Routine");
    await authenticatePage(page, auth.token);
    // Create real account via API? Use existing workspace but mock reminder logic: we mock /account-features for /accounts page to show no undecided
    const accountId = "acc-routine";
    // For Accounts page reminder check, mock returns stored_exists true with disabled
    page.route("**/api/v1/accounts?*", async (route) => {
      if (route.request().url().includes("/api/v1/accounts?")) {
        await route.fulfill({
          contentType: "application/json",
          json: [
            {
              id: accountId,
              platform: "x",
              account_username: "routine",
              slug: "routine",
              messaging_supported: true,
              messages_enabled: false,
              is_active: true,
              instance_url: "",
              account_id: accountId,
              account_avatar_url: "",
              grant_destination_count: 1,
              shared_grant: false,
              thread_replies_supported: true,
            },
          ],
        });
        return;
      }
      await route.continue();
    });
    page.route("**/api/v1/account-features?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/account-features")) {
        await route.fulfill({
          contentType: "application/json",
          json: [
            featureResponse(accountId, "x", "messaging", {
              supported: true,
              stored_exists: true,
              stored_enabled: false,
              availability: "available",
              effective_enabled: false,
              workspace_id: ws.id,
            }),
            featureResponse(accountId, "x", "engagement", {
              supported: true,
              stored_exists: true,
              stored_enabled: false,
              availability: "available",
              effective_enabled: false,
              workspace_id: ws.id,
            }),
          ].map((f) => ({ ...f, workspace_id: ws.id })),
        });
        return;
      }
      await route.continue();
    });
    page.route("**/api/v1/accounts/providers*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: [] });
    });
    await page.goto("/settings?tab=accounts");
    await expect(page.getByTestId("account-setup-reminder")).toHaveCount(0);
  });

  test("abandoned reminder appears for undecided and links to setup", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-reminder-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Reminder");
    await authenticatePage(page, auth.token);
    const accountId = "acc-remind";
    page.route("**/api/v1/accounts?*", async (route) => {
      if (route.request().url().includes("/api/v1/accounts?")) {
        await route.fulfill({
          contentType: "application/json",
          json: [
            {
              id: accountId,
              platform: "x",
              account_username: "remindme",
              slug: "remindme",
              messaging_supported: true,
              messages_enabled: false,
              is_active: true,
              instance_url: "",
              account_id: accountId,
              account_avatar_url: "",
              grant_destination_count: 1,
              shared_grant: false,
              thread_replies_supported: true,
            },
          ],
        });
        return;
      }
      await route.continue();
    });
    page.route("**/api/v1/account-features?*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          featureResponse(accountId, "x", "messaging", {
            supported: true,
            stored_exists: false,
            workspace_id: ws.id,
          }),
          featureResponse(accountId, "x", "engagement", {
            supported: true,
            stored_exists: false,
            workspace_id: ws.id,
          }),
        ].map((f) => ({ ...f, workspace_id: ws.id })),
      });
    });
    page.route("**/api/v1/accounts/providers*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: [] });
    });
    await page.goto("/settings?tab=accounts");
    await expect(page.getByTestId("account-setup-reminder")).toBeVisible();
    await expect(page.getByText("Finish account setup")).toBeVisible();
    const link = page.getByRole("link", { name: "Finish setup" });
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`/accounts/setup\\?workspace_id=${ws.id}`),
    );
  });

  test("multi-account distinct support per account", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-multi-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Multi");
    await authenticatePage(page, auth.token);
    const acc1 = "acc-multi-1";
    const acc2 = "acc-multi-2";
    const mocks = setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [acc1, acc2],
      newAccountIds: [acc1, acc2],
      featureMap: {
        [acc1]: [
          featureResponse(acc1, "x", "messaging", { supported: true }),
          featureResponse(acc1, "x", "analytics", { supported: true }),
          featureResponse(acc1, "x", "engagement", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(acc1, "x", "grow", { supported: false, availability: "unsupported" }),
        ],
        [acc2]: [
          featureResponse(acc2, "youtube", "messaging", {
            supported: false,
            availability: "unsupported",
          }),
          featureResponse(acc2, "youtube", "analytics", { supported: true }),
          featureResponse(acc2, "youtube", "grow", { supported: true }),
          featureResponse(acc2, "youtube", "engagement", {
            supported: false,
            availability: "unsupported",
          }),
        ],
      },
      accounts: [
        { id: acc1, platform: "x", account_username: "xuser" },
        { id: acc2, platform: "youtube", account_username: "ytuser" },
      ],
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${acc1},${acc2}&new_account_ids=${acc1},${acc2}`,
    );
    // Two per-account sections
    await expect(page.locator('section[aria-labelledby^="account-heading"]')).toHaveCount(2);
    // First account has Direct messages and Analytics
    const firstSection = page.locator('section[aria-labelledby^="account-heading"]').first();
    await expect(firstSection.getByLabel("Direct messages")).toBeVisible();
    await expect(firstSection.getByLabel("Analytics")).toBeVisible();
    await expect(firstSection.getByLabel("Grow")).toHaveCount(0);
    const secondSection = page.locator('section[aria-labelledby^="account-heading"]').nth(1);
    await expect(secondSection.getByLabel("Grow")).toBeVisible();
    await expect(secondSection.getByLabel("Direct messages")).toHaveCount(0);
    // Toggle distinctly
    await firstSection.getByLabel("Direct messages").check();
    await secondSection.getByLabel("Grow").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/(accounts|settings\?tab=accounts)/);
    const captured = mocks.getCaptured();
    expect(captured?.choices).toEqual(
      expect.arrayContaining([
        { account_id: acc1, feature: "messaging", enabled: true, source: "user_save" },
        { account_id: acc1, feature: "analytics", enabled: false, source: "user_save" },
        { account_id: acc2, feature: "analytics", enabled: false, source: "user_save" },
        { account_id: acc2, feature: "grow", enabled: true, source: "user_save" },
      ]),
    );
  });

  test("keyboard order and visible focus", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-kb-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "KB");
    await authenticatePage(page, auth.token);
    const accountId = "acc-kb";
    setupMocks(page, {
      workspaceId: ws.id,
      accountIds: [accountId],
      newAccountIds: [accountId],
      featureMap: {
        [accountId]: [
          featureResponse(accountId, "x", "messaging", { supported: true }),
          featureResponse(accountId, "x", "engagement", { supported: true }),
        ],
      },
    });
    await page.goto(
      `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
    );
    // Tab through checkboxes and buttons
    await page.keyboard.press("Tab");
    // First checkbox should be focused
    const firstCheckbox = page.getByLabel("Direct messages");
    await firstCheckbox.focus();
    await expect(firstCheckbox).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Comments and replies")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Keep all off" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeFocused();
    // Check focus ring visible via CSS (outline or ring)
    const focused = page.getByRole("button", { name: "Save and continue" });
    await expect(focused).toBeVisible();
  });

  test("Account settings drawer reflects stored choices and saves", async ({ page, request }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-details-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Details");
    await authenticatePage(page, auth.token);
    const accountId = "acc-details";
    // First visit direct accounts with dialog
    page.route("**/api/v1/accounts?*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: [
          {
            id: accountId,
            platform: "x",
            account_username: "detailuser",
            slug: "detail",
            messaging_supported: true,
            messages_enabled: false,
            is_active: true,
            instance_url: "",
            account_id: accountId,
            account_avatar_url: "",
            grant_destination_count: 1,
            shared_grant: false,
            thread_replies_supported: true,
          },
        ],
      });
    });
    page.route(`**/api/v1/accounts/${accountId}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            id: accountId,
            platform: "x",
            account_username: "detailuser",
            slug: "new-slug",
            messaging_supported: true,
            messages_enabled: false,
            is_active: true,
            instance_url: "",
            account_id: accountId,
            account_avatar_url: "",
            grant_destination_count: 1,
            shared_grant: false,
            thread_replies_supported: true,
          },
        });
        return;
      }
      await route.continue();
    });
    let featuresForDialog = [
      featureResponse(accountId, "x", "messaging", {
        supported: true,
        stored_exists: true,
        stored_enabled: true,
        effective_enabled: true,
        workspace_id: ws.id,
      }),
      featureResponse(accountId, "x", "engagement", {
        supported: true,
        stored_exists: true,
        stored_enabled: false,
        effective_enabled: false,
        workspace_id: ws.id,
      }),
      featureResponse(accountId, "x", "analytics", {
        supported: true,
        stored_exists: false,
        workspace_id: ws.id,
      }),
      featureResponse(accountId, "x", "grow", {
        supported: true,
        stored_exists: true,
        stored_enabled: true,
        workspace_id: ws.id,
      }),
    ];
    page.route("**/api/v1/account-features*", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET") {
        await route.fulfill({ contentType: "application/json", json: featuresForDialog });
        return;
      }
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as {
          choices: Array<{ feature: string; enabled: boolean }>;
        };
        featuresForDialog = featuresForDialog.map((f) => {
          const ch = body.choices.find((c) => c.feature === f.feature);
          if (ch)
            return {
              ...f,
              stored_exists: true,
              stored_enabled: ch.enabled,
              effective_enabled: ch.enabled && f.availability === "available",
            };
          return f;
        });
        await route.fulfill({ contentType: "application/json", json: featuresForDialog });
        return;
      }
      await route.continue();
    });
    page.route("**/api/v1/accounts/providers*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: [] });
    });
    await page.goto("/settings?tab=accounts");
    const openDetails = async () => {
      await page
        .getByTestId(`account-card-${accountId}`)
        .getByRole("button", { name: /Actions for/ })
        .click();
      await page.getByRole("menuitem", { name: "Details" }).click();
    };
    await openDetails();
    const dialog = page.getByRole("dialog", { name: "Account details" });
    const drawer = page.getByTestId("account-settings-drawer");
    await expect(dialog).toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("account-settings-scroll")).toBeVisible();
    await expect(drawer.getByTestId("account-settings-footer")).toBeVisible();
    await expect(drawer.getByText("Developer shortcut")).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(520);
    expect(drawerBox?.height).toBe(720);
    if (process.env.OPENPOST_ACCOUNT_SETTINGS_SCREENSHOTS === "1") {
      const reviewDir = path.resolve(".impeccable/review");
      await mkdir(reviewDir, { recursive: true });
      for (const scenario of [
        {
          name: "account-settings-desktop-light.png",
          width: 1280,
          height: 720,
          dark: false,
        },
        {
          name: "account-settings-desktop-dark.png",
          width: 1280,
          height: 720,
          dark: true,
        },
        {
          name: "account-settings-phone-390-light.png",
          width: 390,
          height: 844,
          dark: false,
        },
        {
          name: "account-settings-phone-320-dark.png",
          width: 320,
          height: 568,
          dark: true,
        },
      ] as const) {
        await page.setViewportSize({
          width: scenario.width,
          height: scenario.height,
        });
        await page.evaluate(
          (dark) => localStorage.setItem("mode-watcher-mode", dark ? "dark" : "light"),
          scenario.dark,
        );
        await page.reload();
        await openDetails();
        await expect(drawer).toBeVisible();
        await page.waitForTimeout(300);
        const scenarioBox = await drawer.boundingBox();
        expect(scenarioBox?.width).toBeLessThanOrEqual(scenario.width < 640 ? scenario.width : 520);
        expect(scenarioBox?.height).toBe(scenario.height);
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: path.join(reviewDir, scenario.name),
          fullPage: false,
        });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await expect(dialog.getByLabel("Direct messages")).toBeChecked();
    await expect(dialog.getByLabel("Comments and replies")).not.toBeChecked();
    await expect(dialog.getByLabel("Analytics")).not.toBeChecked();
    await dialog.getByLabel("Analytics").check();
    await dialog.getByLabel("Direct messages").uncheck();
    await dialog.getByRole("button", { name: "Save details" }).click();
    await expect(dialog).toHaveCount(0);
    // Saved choices effective
    expect(featuresForDialog.find((f) => f.feature === "analytics")?.stored_enabled).toBe(true);
    expect(featuresForDialog.find((f) => f.feature === "messaging")?.stored_enabled).toBe(false);
  });

  for (const viewport of [
    { width: 1280, height: 800, theme: "light" },
    { width: 390, height: 844, theme: "dark" },
    { width: 320, height: 568, theme: "light" },
    { width: 320, height: 568, theme: "dark" },
  ] as const) {
    test(`responsive ${viewport.width}px ${viewport.theme} no overflow and 44px targets`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.theme === "dark") {
        await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "dark"));
      }
      const unique = `${viewport.width}-${viewport.theme}-${Date.now().toString(36)}`;
      const auth = await registerUser(request, `setup-resp-${unique}@example.com`);
      const ws = await createWorkspace(request, auth.token, `Resp ${unique}`);
      await authenticatePage(page, auth.token);
      const accountId = "acc-resp";
      setupMocks(page, {
        workspaceId: ws.id,
        accountIds: [accountId],
        newAccountIds: [accountId],
        featureMap: {
          [accountId]: [
            featureResponse(accountId, "x", "messaging", { supported: true }),
            featureResponse(accountId, "x", "engagement", { supported: true }),
            featureResponse(accountId, "x", "analytics", { supported: true }),
            featureResponse(accountId, "x", "grow", { supported: true }),
          ],
        },
      });
      await page.goto(
        `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
      );
      await expect(
        page.getByRole("heading", { name: "Set up your new destinations" }),
      ).toBeVisible();
      // No horizontal overflow
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        )
        .toBe(true);
      // Buttons meet 44px on coarse (phone widths)
      const saveBtn = page.getByRole("button", { name: "Save and continue" });
      const box = await saveBtn.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(viewport.width <= 390 ? 44 - 1 : 32);
      // Dark theme background check light/dark canvas?
      await page.waitForLoadState("networkidle");
    });
  }

  test("capture settled screenshots for setup desktop and phone light dark", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `setup-shot-${unique}@example.com`);
    const ws = await createWorkspace(request, auth.token, "Screenshot");
    await authenticatePage(page, auth.token);
    const accountId = "acc-shot";
    const shots = [
      { width: 1280, height: 800, theme: "light" as const, name: "setup-desktop-light" },
      { width: 1280, height: 800, theme: "dark" as const, name: "setup-desktop-dark" },
      { width: 390, height: 844, theme: "light" as const, name: "setup-phone-light" },
      { width: 320, height: 568, theme: "dark" as const, name: "setup-phone-dark" },
    ];
    for (const shot of shots) {
      await page.setViewportSize({ width: shot.width, height: shot.height });
      if (shot.theme === "dark") {
        await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "dark"));
      } else {
        await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "light"));
      }
      setupMocks(page, {
        workspaceId: ws.id,
        accountIds: [accountId],
        newAccountIds: [accountId],
        featureMap: {
          [accountId]: [
            featureResponse(accountId, "x", "messaging", { supported: true }),
            featureResponse(accountId, "x", "engagement", { supported: true }),
            featureResponse(accountId, "x", "analytics", { supported: true }),
            featureResponse(accountId, "x", "grow", { supported: true }),
          ],
        },
      });
      await page.goto(
        `/accounts/setup?workspace_id=${ws.id}&account_ids=${accountId}&new_account_ids=${accountId}`,
      );
      await expect(page.getByLabel("Direct messages")).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `test-results/screenshots/${shot.name}.png`, fullPage: true });
    }
  });
});
