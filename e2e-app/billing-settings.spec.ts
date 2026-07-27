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
  await page.getByLabel("Display name").fill("Profile E2E User");
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
  await expect(page.getByRole("status")).toHaveText("Profile updated");
  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(page.getByRole("status")).toHaveCount(0);
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

  const otherSession = page
    .getByTestId("auth-session-row")
    .filter({ hasText: "Browser on device" });
  await otherSession.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByTestId("auth-session-list")).not.toContainText(
    "Browser on device",
  );
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
    "MCP / inspect only",
  );
  await expect(page.getByText(/Recommended for inspection/)).toBeVisible();
  await page.locator("#api-token-name").fill("ChatGPT App E2E");
  await page.getByRole("button", { name: "Create Token" }).click();

  await expect(page.getByText("Copy this token now")).toBeVisible();
  await expect(page.getByText(/op_cli_[a-f0-9]{8}_/)).toBeVisible();
  const createdToken = page.getByText("ChatGPT App E2E").locator("..");
  await expect(createdToken).toBeVisible();
  await expect(createdToken).toContainText("MCP / inspect only");
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
  await page.route("**/api/v1/**/billing/checkout", async (route) => {
    checkoutURL = route.request().url();
    checkoutBody = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      contentType: "application/json",
      json: { id: "checkout-e2e", url: "/settings?checkout=creator" },
    });
  });

  await page.goto("/register?plan=creator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/onboarding\?plan=creator/);
  await page.getByLabel("Workspace name").fill("Plan Handoff E2E");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page).toHaveURL(/\/\?sample=campaign&plan=creator/);
  await expect(
    page.getByRole("heading", { name: "Review an agent-prepared campaign" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue plan setup" }).click();

  await expect(page).toHaveURL(/\/settings\?checkout=creator/);
  expect(checkoutURL).toContain("/organizations/");
  expect(checkoutBody?.plan_id).toBe("creator");
});
