import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("settings exposes and retries API-token load failures", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `token-load-recovery-${unique}@example.com`,
  );
  await createWorkspace(request, auth.token, "Token Recovery E2E");
  await authenticatePage(page, auth.token);

  let tokenRequests = 0;
  await page.route("**/api/v1/api-tokens", async (route) => {
    tokenRequests++;
    if (tokenRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "recovered-token",
          name: "Recovered CLI token",
          token_prefix: "op_cli_recovered",
          scope: "cli:full",
          created_at: "2026-07-20T12:00:00Z",
        },
      ],
    });
  });

  await page.goto("/settings?tab=developer");

  const loadError = page.getByTestId("api-tokens-load-error");
  await expect(loadError).toContainText("Could not load API tokens.");
  await expect(
    page.getByText("No API tokens or CLI devices are currently authorized."),
  ).toHaveCount(0);
  expect(tokenRequests).toBe(1);

  await loadError.getByRole("button", { name: "Try again" }).click();

  await expect(loadError).toHaveCount(0);
  await expect(page.getByText("Recovered CLI token")).toBeVisible();
  expect(tokenRequests).toBe(2);
});

test("accounts exposes independent recovery for accounts and providers", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `account-load-recovery-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Account Recovery E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);

  let accountRequests = 0;
  await page.route("**/api/v1/accounts?**", async (route) => {
    accountRequests++;
    if (accountRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: "recovered-account",
          workspace_id: workspace.id,
          platform: "x",
          account_id: "recovered-account-id",
          account_username: "recovered_account",
          is_active: true,
          slug: "recovered-account",
          thread_replies_supported: true,
        },
      ],
    });
  });

  let providerRequests = 0;
  await page.route("**/api/v1/accounts/providers", async (route) => {
    providerRequests++;
    if (providerRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          platform: "x",
          display_name: "X (Twitter)",
          auth_mode: "oauth",
          configured: true,
          status: "available",
        },
      ],
    });
  });

  await page.goto("/settings?tab=accounts");

  const accountsError = page.getByTestId("accounts-load-error");
  const providersError = page.getByTestId("providers-load-error");
  await expect(accountsError).toContainText(
    "Failed to load connected accounts",
  );
  await expect(providersError).toContainText(
    "Could not load available platforms.",
  );
  await expect(
    page.getByRole("heading", { name: "No accounts connected" }),
  ).toHaveCount(0);
  await expect(page.locator('[data-testid^="provider-card-"]')).toHaveCount(0);

  await accountsError.getByRole("button", { name: "Try again" }).click();
  await expect(accountsError).toHaveCount(0);
  await expect(page.getByText("@recovered_account")).toBeVisible();

  await providersError.getByRole("button", { name: "Try again" }).click();
  await expect(providersError).toHaveCount(0);
  await expect(page.getByTestId("provider-card-x")).toBeVisible();
  expect(accountRequests).toBe(2);
  expect(providerRequests).toBe(2);
});

test("onboarding does not offer workspace creation when bootstrap fails", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `onboarding-load-recovery-${unique}@example.com`,
  );
  await authenticatePage(page, auth.token);

  let allowWorkspaceLoad = false;
  await page.route("**/api/v1/billing/purchase-choice", (route) =>
    route.fulfill({
      json: {
        token: "choice-founder-monthly",
        plan_id: "founder",
        plan_name: "Founder",
        billing_period: "monthly",
        list_price_usd: 25,
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-12",
        expires_at: "2026-08-13T10:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/workspaces", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (!allowWorkspaceLoad) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        json: { title: "Unavailable", status: 503 },
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.goto("/onboarding?plan=founder&billing_period=monthly");

  const loadError = page.getByTestId("onboarding-load-error");
  await expect(loadError).toContainText("Failed to load workspaces");
  await expect(page.getByLabel("Workspace name")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create Workspace and continue" }),
  ).toHaveCount(0);

  allowWorkspaceLoad = true;
  await loadError.getByRole("button", { name: "Try again" }).click();

  await expect(loadError).toHaveCount(0);
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Workspace and continue" }),
  ).toBeDisabled();
});

test("accepted invitations retry workspace refresh without consuming the token again", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `invite-refresh-recovery-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Invite Refresh Recovery E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);

  let allowWorkspaceRefresh = false;
  await page.route("**/api/v1/workspaces", async (route) => {
    if (route.request().method() !== "GET" || allowWorkspaceRefresh) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      json: { title: "Unavailable", status: 503 },
    });
  });

  let acceptanceRequests = 0;
  await page.route("**/api/v1/workspace-invitations/accept", async (route) => {
    acceptanceRequests++;
    await route.fulfill({
      contentType: "application/json",
      json: { workspace_id: workspace.id, role: "editor" },
    });
  });

  await page.goto("/invite?token=consumed-token");

  await expect(
    page.getByRole("heading", { level: 1, name: "Invitation accepted" }),
  ).toBeVisible();
  await expect(page.getByTestId("invite-error")).toHaveCount(0);
  const refreshError = page.getByTestId("invite-workspace-refresh-error");
  await expect(refreshError).toContainText(
    "You joined the workspace, but OpenPost could not refresh your workspace list.",
  );
  await expect(page.getByRole("link", { name: "Open Settings" })).toHaveCount(
    0,
  );

  allowWorkspaceRefresh = true;
  await refreshError.getByRole("button", { name: "Try again" }).click();

  await expect(refreshError).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
  expect(acceptanceRequests).toBe(1);
});

test("portrait calendar can create on an empty date in a populated month", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `calendar-empty-date-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Calendar Empty Date E2E",
  )) as { id: string };
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 390, height: 844 });
  const calendarNow = new Date("2030-06-15T12:00:00.000Z");
  await page.clock.setFixedTime(calendarNow);

  const scheduledAt = new Date("2030-06-01T10:00:00.000Z").toISOString();

  await page.route("**/api/v1/publications?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Has-More": "false" },
      json: [
        {
          id: "scheduled-publication",
          text_post_id: "scheduled-post",
          workspace_id: workspace.id,
          created_by: "calendar-test-user",
          title: "Scheduled item",
          intent: "post",
          content_profile: "short_text",
          source_text: "Scheduled item",
          source_url: "",
          goal: "",
          audience: "",
          status: "scheduled",
          revision: 1,
          scheduled_at: scheduledAt,
          actual_run_at: "",
          created_at: scheduledAt,
          updated_at: scheduledAt,
          metadata: {},
          renditions: [],
          segments: [
            {
              id: "scheduled-segment",
              position: 0,
              body: "Scheduled item",
              title: "",
              description: "",
              url: "",
              settings: {},
              media: [],
            },
          ],
          media: [],
        },
      ],
    });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.goto("/calendar");

  const emptyDateCreate = page.getByTestId("calendar-empty-date-create");
  await expect(emptyDateCreate).toBeVisible();
  await expect(
    emptyDateCreate.getByRole("button", { name: /Empty date in/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);

  await emptyDateCreate.getByRole("button", { name: "Create post" }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("date"))
    .toBe("2030-06-15");
  expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(
    workspace.id,
  );
});
