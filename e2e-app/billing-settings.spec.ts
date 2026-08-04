import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
  routeBrowserRegistration,
} from "./helpers";

test("settings shows billing plan controls for an authenticated workspace", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `billing-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Billing E2E");

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=plan");

  await expect(
    page.getByRole("heading", { name: "Plan & usage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Billing", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No active plan")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Customer Portal" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Choose / })).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Creator" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
  await expect(
    page.locator("#billing").getByRole("heading", { name: "Team" }),
  ).toBeVisible();
  await expect(
    page.locator("#billing").getByRole("heading", { name: "Agency" }),
  ).toBeVisible();
});

test("settings keeps hosted X costs separate from product usage", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `provider-cost-${unique}@example.com`;

  const auth = await registerUser(request, email);
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Provider Cost E2E",
  );
  let billingStatusRequests = 0;

  await page.route("**/api/v1/billing/status?**", async (route) => {
    billingStatusRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        organization_id: workspace.organization_id,
        workspace_id: workspace.id,
        status: "active",
        plan_id: "creator",
        cancel_at_period_end: false,
        limits: {},
        usage: {},
        period_start: "2026-07-01T00:00:00Z",
        provider_costs: [
          {
            provider: "x",
            currency: "USD",
            period_start: "2026-07-01T00:00:00Z",
            event_count: 2,
            units: 2,
            cost_microusd: 215000,
            reserved_event_count: 1,
            reserved_units: 1,
            reserved_cost_microusd: 200000,
            budget_microusd: 5000000,
            pricing_source_url:
              "https://docs.x.com/x-api/getting-started/pricing",
            operations: [
              {
                operation: "post_create",
                event_count: 1,
                units: 1,
                cost_microusd: 15000,
                reserved_event_count: 0,
                reserved_units: 0,
                reserved_cost_microusd: 0,
              },
              {
                operation: "post_create_with_url",
                event_count: 1,
                units: 1,
                cost_microusd: 200000,
                reserved_event_count: 1,
                reserved_units: 1,
                reserved_cost_microusd: 200000,
              },
            ],
          },
        ],
      },
    });
  });

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=plan");

  await expect.poll(() => billingStatusRequests).toBeGreaterThan(0);
  const visibleBillingStatus = await page.evaluate(async (workspaceID) => {
    const response = await fetch(
      `/api/v1/billing/status?workspace_id=${encodeURIComponent(workspaceID)}`,
    );
    return response.json();
  }, workspace.id);
  expect(visibleBillingStatus.provider_costs).toHaveLength(1);

  const costs = page.getByTestId("provider-cost-usage");
  await expect(costs).toBeVisible();
  await expect(costs).toContainText("X API use");
  await expect(costs).toContainText(
    "$0.215 confirmed + $0.20 held of the $5.00 monthly safety limit",
  );
  await expect(costs).toContainText("Posts without links");
  await expect(costs).toContainText("Posts with links");
  await expect(costs).toContainText("1 request still being checked");
  await expect(
    costs.getByRole("link", { name: "View X pricing" }),
  ).toHaveAttribute("href", "https://docs.x.com/x-api/getting-started/pricing");
});

test("instance admins can review usage, users, and update status", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `update-status-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Update Status E2E");
  const meResponse = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(meResponse.ok()).toBeTruthy();
  const me = await meResponse.json();
  let profileRequests = 0;
  let overviewRequests = 0;
  const requestedUserPages: number[] = [];
  const requestedUserSorts: string[] = [];
  let impersonationLinkRequests = 0;
  let updateStatusRequests = 0;

  await page.route("**/api/v1/auth/me", async (route) => {
    profileRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: { ...me, is_admin: true },
    });
  });
  await page.route("**/api/v1/admin/overview", async (route) => {
    overviewRequests += 1;
    const trend = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      value: index % 6 === 0 ? 1 : 0,
    }));
    await route.fulfill({
      contentType: "application/json",
      json: {
        total_users: 42,
        new_users_last_30_days: 5,
        total_workspaces: 12,
        published_last_30_days: 86,
        user_registration_trend: trend,
        publication_trend: trend.map((point, index) => ({
          ...point,
          value: index % 3,
        })),
      },
    });
  });
  await page.route("**/api/v1/admin/users?**", async (route) => {
    const requestURL = new URL(route.request().url());
    const requestedPage = Number(requestURL.searchParams.get("page") ?? "1");
    requestedUserPages.push(requestedPage);
    requestedUserSorts.push(
      `${requestURL.searchParams.get("sort")}:${requestURL.searchParams.get("direction")}`,
    );
    const pageStart = (requestedPage - 1) * 25;
    const userCount = requestedPage === 2 ? 17 : 25;
    const users = Array.from({ length: userCount }, (_, index) => {
      const userNumber = pageStart + index + 1;
      return {
        id: `user-${userNumber}`,
        email: `user-${userNumber}@example.com`,
        display_name:
          userNumber === 1
            ? "Ada Admin"
            : userNumber === 26
              ? "Page Two User"
              : `User ${userNumber}`,
        avatar_url: "",
        is_admin: userNumber === 1,
        plan_ids: userNumber === 1 ? ["team"] : ["creator"],
        organization_count: (userNumber % 2) + 1,
        workspace_count: userNumber % 4,
        social_account_count: userNumber % 3,
        publication_count: userNumber * 2,
        last_active_at: `2026-07-${String(29 - (index % 20)).padStart(2, "0")}T15:30:00Z`,
        created_at: `2026-07-${String(29 - (index % 20)).padStart(2, "0")}T12:00:00Z`,
      };
    });
    await route.fulfill({
      contentType: "application/json",
      json: {
        users,
        total: 42,
        page: requestedPage,
        per_page: 25,
        total_pages: 2,
      },
    });
  });
  await page.route(
    "**/api/v1/admin/users/*/impersonation-links",
    async (route) => {
      impersonationLinkRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        json: {
          url: "http://127.0.0.1:18180/impersonate#code=one-use-test-code",
          expires_at: "2026-07-29T12:05:00Z",
        },
      });
    },
  );
  await page.route("**/api/v1/admin/update-status", async (route) => {
    updateStatusRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        state: "update_available",
        running_version: "v1.27.9",
        running_build: "0123456789abcdef",
        latest_version: "v1.28.0",
        release_url: "https://github.com/rodrgds/openpost/releases/tag/v1.28.0",
        published_at: "2026-07-27T10:00:00Z",
        checked_at: "2026-07-27T12:00:00Z",
      },
    });
  });

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=instance");

  await expect.poll(() => profileRequests).toBeGreaterThan(0);
  await expect.poll(() => overviewRequests).toBeGreaterThan(0);
  await expect.poll(() => updateStatusRequests).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Instance", level: 1 }),
  ).toBeVisible();

  const overview = page.getByTestId("instance-admin-overview");
  await expect(overview).toContainText("Total users");
  await expect(overview).toContainText("42");
  await expect(overview).toContainText("Published posts");
  await expect(overview.locator('[data-slot="chart"]')).toHaveCount(2);

  const status = page.getByTestId("instance-update-status");
  await expect(status).toContainText("OpenPost v1.28.0 is available.");
  await expect(status).toContainText("v1.27.9");
  await expect(status).toContainText("OpenPost never installs updates");
  await expect(
    status.getByRole("link", { name: "View release" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/rodrgds/openpost/releases/tag/v1.28.0",
  );
  await expect(status.getByRole("button", { name: /update/i })).toHaveCount(0);

  await page.locator('[data-settings-tab="users"]').click();
  await expect(page).toHaveURL(/settings\?tab=users/);
  await expect(
    page.getByRole("heading", { name: "Users", level: 1 }),
  ).toBeVisible();
  await expect.poll(() => requestedUserPages).toContain(1);

  const usersPanel = page.getByTestId("instance-admin-users");
  const directory = page.getByTestId("instance-user-directory");
  await expect(directory).toContainText("Ada Admin");
  await expect(directory).toContainText("Instance admin");
  await expect(directory).toContainText("Creator");
  await expect(directory).toContainText("Publications");
  await expect(usersPanel).toContainText("Showing 1–25 of 42");

  await directory.getByRole("button", { name: "Sort by User" }).click();
  await expect.poll(() => requestedUserSorts).toContain("display_name:asc");

  await directory
    .getByRole("button", { name: "Impersonate User 2", exact: true })
    .click();
  await expect.poll(() => impersonationLinkRequests).toBe(1);
  const impersonationDialog = page.getByRole("dialog");
  await expect(impersonationDialog).toContainText("Impersonate User 2");
  await expect(
    impersonationDialog.getByRole("textbox", {
      name: "Private sign-in link",
    }),
  ).toHaveValue("http://127.0.0.1:18180/impersonate#code=one-use-test-code");
  await expect(impersonationDialog).toContainText(
    "private or incognito window",
  );
  await impersonationDialog
    .locator("button")
    .filter({ hasText: /^Close$/ })
    .click();

  await usersPanel.getByRole("button", { name: "Go to user page 2" }).click();
  await expect.poll(() => requestedUserPages).toContain(2);
  await expect(directory).toContainText("Page Two User");
  await expect(usersPanel).toContainText("Showing 26–42 of 42");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(directory).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("settings shows recent MCP activity for an authenticated user", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `mcp-activity-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "MCP Activity E2E");

  const mcpCall = await request.post("/mcp", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "list_workspaces",
        arguments: {},
      },
    },
  });
  expect(mcpCall.ok()).toBeTruthy();
  const mcpBody = await mcpCall.json();
  expect(mcpBody.error).toBeFalsy();

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=developer");

  await expect(
    page.getByRole("heading", { name: "Recent MCP Activity" }),
  ).toBeVisible();
  await expect(page.getByTestId("mcp-activity-list")).toContainText(
    "list_workspaces",
  );
  await expect(page.getByTestId("mcp-activity-list")).toContainText("success");
});

test("settings account tab updates the user profile", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `profile-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Profile E2E");

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=profile");

  await expect(
    page.getByRole("heading", { name: "Profile", level: 1 }),
  ).toBeVisible();
  await page
    .locator("section#profile")
    .getByRole("textbox", { name: "Display name", exact: true })
    .fill("Profile E2E User");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("Profile updated")).toBeVisible();

  const me = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(me.ok()).toBeTruthy();
  const meBody = await me.json();
  expect(meBody.display_name).toBe("Profile E2E User");
});

test("settings keeps the active mobile tab visible and exposes dismissible status feedback", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `settings-mobile-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Mobile Settings E2E");

  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings?tab=plan");

  const activeTab = page.locator("aside").getByRole("button", {
    name: "Settings",
  });
  await expect(activeTab).toContainText("Plan & usage");
  await expect(activeTab).toBeInViewport();

  await page.goto("/settings?tab=profile");
  await page.getByRole("button", { name: "Save Profile" }).click();
  const savedToast = page.locator("[data-sonner-toast]").filter({
    hasText: "Profile updated",
  });
  await expect(savedToast).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Close toast" });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(savedToast).toHaveCount(0);
});

test("settings lists and revokes active web sessions", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `sessions-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Sessions E2E");

  const secondLogin = await request.post("/api/v1/auth/login", {
    headers: { "User-Agent": "E2E Other Browser" },
    data: { email, password },
  });
  expect(secondLogin.ok()).toBeTruthy();

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=security");

  await expect(
    page.getByRole("heading", { name: "Active Sessions" }),
  ).toBeVisible();
  await expect(page.getByTestId("auth-session-list")).toContainText("Current");
  await expect(page.getByTestId("auth-session-list")).toContainText(
    "Browser on device",
  );
  await expect(page.getByTestId("auth-session-list")).not.toContainText(
    "E2E Other Browser",
  );

  const otherSession = page.getByTestId("auth-session-row").filter({
    has: page.getByRole("button", { name: "Remove access" }),
  });
  await expect(otherSession).toHaveCount(1);
  await otherSession.getByRole("button", { name: "Remove access" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove access" })
    .click();
  await expect(
    page.getByTestId("auth-session-list").getByRole("button", {
      name: "Remove access",
    }),
  ).toHaveCount(0);
});

test("settings creates read-only MCP API tokens by default", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `mcp-token-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "MCP Token E2E");

  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=developer");

  await expect(page.getByTestId("api-token-scope")).toContainText(
    "MCP / read only",
  );
  await expect(page.getByText(/Best for read-only work/)).toBeVisible();
  await page.locator("#api-token-name").fill("ChatGPT App E2E");
  await page.getByRole("button", { name: "Create Token" }).click();

  await expect(page.getByText("Copy this token now")).toBeVisible();
  await expect(page.getByText(/op_cli_[a-f0-9]{8}_/)).toBeVisible();
  const createdToken = page.getByText("ChatGPT App E2E").locator("..");
  await expect(createdToken).toBeVisible();
  await expect(createdToken).toContainText("MCP / read only");
});

test("settings creates and accepts workspace invitations", async ({
  browser,
  baseURL,
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const adminEmail = `team-admin-${unique}@example.com`;
  const inviteEmail = `team-member-${unique}@example.com`;

  const adminAuth = await registerUser(request, adminEmail);
  await createWorkspace(request, adminAuth.token, "Team E2E");

  await authenticatePage(page, adminAuth.token);
  await page.goto("/settings?tab=members");

  await expect(
    page.locator("#team").getByRole("heading", { name: "Team" }),
  ).toBeVisible();

  await page.getByTestId("team-invite-email").fill(inviteEmail);
  await page.getByRole("button", { name: "Send Invite" }).click();

  await expect(page.getByTestId("team-invite-link")).toContainText(
    "/invite?token=op_inv_",
  );
  await expect(page.getByTestId("team-invitations-list")).toContainText(
    inviteEmail,
  );

  const inviteLinkText = (await page
    .getByTestId("team-invite-link")
    .textContent())!;
  const inviteURL = inviteLinkText.match(
    /https?:\/\/\S+\/invite\?token=\S+/,
  )?.[0];
  expect(inviteURL).toBeTruthy();

  const invitedAuth = await registerUser(request, inviteEmail);
  const invitedContext = await browser.newContext({ baseURL });
  const invitedPage = await invitedContext.newPage();
  await authenticatePage(invitedPage, invitedAuth.token);

  const parsedInviteURL = new URL(inviteURL!);
  await invitedPage.goto(
    `${parsedInviteURL.pathname}${parsedInviteURL.search}`,
  );

  await expect(
    invitedPage.getByRole("heading", { name: "Invitation accepted" }),
  ).toBeVisible();
  await expect(invitedPage.getByText("editor access")).toBeVisible();

  await invitedPage.getByRole("link", { name: "Open Settings" }).click();
  await expect(invitedPage).toHaveURL(/\/settings\?tab=members$/);
  await expect(
    invitedPage.locator("#team").getByRole("heading", { name: "Team" }),
  ).toBeVisible();
  await expect(invitedPage.getByTestId("team-members-list")).toContainText(
    inviteEmail,
  );
  await invitedContext.close();
});

test("plan selection from signup starts checkout after onboarding", async ({
  page,
}) => {
  const unique = Date.now().toString(36);
  const email = `plan-signup-${unique}@example.com`;
  let checkoutBody: { workspace_id?: string; plan_id?: string } | undefined;
  let checkoutURL = "";

  await routeBrowserRegistration(page, email);
  await page.route("https://js.whop.com/**", async (route) => {
    await route.fulfill({ contentType: "application/javascript", body: "" });
  });
  await page.route("**/api/v1/billing/checkout", async (route) => {
    checkoutURL = route.request().url();
    checkoutBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      contentType: "application/json",
      json: {
        id: "checkout-e2e",
        url: "/checkout?plan=creator&billing_period=monthly&session_id=checkout-e2e",
        purchase_url: "https://whop.com/checkout/plan_creator_month",
        provider_plan_id: "plan_creator_month",
        plan_id: "creator",
        billing_period: "monthly",
        price_usd: 29,
        trial_ends_at: "2026-08-18T12:00:00Z",
        return_url:
          "http://127.0.0.1/checkout?plan=creator&billing_period=monthly&status=success",
      },
    });
  });

  await page.goto("/register?plan=creator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/onboarding\?plan=creator/);

  await expect(page).toHaveURL(
    /\/checkout\?plan=creator&billing_period=monthly$/,
  );
  await expect(
    page.getByRole("heading", { name: "Put your content team to work" }),
  ).toBeVisible();
  await expect(page.getByText("$0 due today")).toBeVisible();
  await expect(page.locator("#openpost-whop-checkout")).toHaveAttribute(
    "data-whop-checkout-session",
    "checkout-e2e",
  );
  await expect(page.locator("#openpost-whop-checkout")).toHaveAttribute(
    "data-whop-checkout-plan-id",
    "plan_creator_month",
  );
  expect(checkoutURL).toContain("/api/v1/billing/checkout");
  expect(checkoutBody?.plan_id).toBe("creator");
});
