import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("workspace admins manage the complete member and invitation lifecycle", async ({
  page,
  request,
}, testInfo) => {
  test.slow();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const unique = Date.now().toString(36);
  const admin = await registerUser(request, `team-admin-${unique}@example.com`);
  const memberEmail = `team-member-${unique}@example.com`;
  const member = await registerUser(request, memberEmail);
  const workspace = await createWorkspace(request, admin.token, "Team Lifecycle E2E");
  const adminProfileResponse = await request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(adminProfileResponse.ok()).toBeTruthy();
  const adminProfile = await adminProfileResponse.json();

  const invitationResponse = await request.post(`/api/v1/workspaces/${workspace.id}/invitations`, {
    headers: { Authorization: `Bearer ${admin.token}` },
    data: { email: memberEmail, role: "viewer" },
  });
  expect(invitationResponse.ok()).toBeTruthy();
  const invitation = await invitationResponse.json();
  expect(invitation.token).toBeUndefined();
  const invitationToken = new URL(invitation.accept_url).searchParams.get("token");
  expect(invitationToken).toBeTruthy();
  const acceptanceResponse = await request.post("/api/v1/workspace-invitations/accept", {
    headers: { Authorization: `Bearer ${member.token}` },
    data: { token: invitationToken },
  });
  expect(acceptanceResponse.ok()).toBeTruthy();

  await authenticatePage(page, admin.token);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/settings?tab=members&workspace=${workspace.id}`);
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByText("2 seats reserved")).toBeVisible();

  await page.getByLabel("Search team").fill(memberEmail);
  const memberCard = page
    .getByTestId("team-members-list")
    .locator("div.rounded-md.border")
    .filter({ hasText: memberEmail });
  await expect(memberCard).toBeVisible();
  await memberCard.getByLabel(`Role for ${memberEmail}`).click();
  await page.getByRole("option", { name: "Editor" }).click();
  await expect(page.getByText("Member role updated.")).toBeVisible();
  await expect(page.getByText(`${memberEmail} changed from Viewer to Editor.`)).toBeVisible();

  await memberCard.getByRole("button", { name: "Deactivate" }).click();
  const deactivateDialog = page.getByRole("dialog");
  await expect(
    deactivateDialog.getByRole("heading", { name: "Deactivate this member?" }),
  ).toBeVisible();
  await deactivateDialog.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Member access deactivated.")).toBeVisible();
  await expect(page.getByText("1 seat reserved")).toBeVisible();

  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Inactive" }).click();
  await expect(memberCard).toBeVisible();
  await memberCard.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("Member access reactivated.")).toBeVisible();

  await page.getByLabel("Search team").fill("");
  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "All statuses" }).click();
  const pendingEmail = `pending-${unique}@example.com`;
  let failNextTeamReload = false;
  await page.route(`**/api/v1/workspaces/${workspace.id}/team*`, async (route) => {
    if (!failNextTeamReload) return route.continue();
    failNextTeamReload = false;
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ detail: "Temporary team reload failure" }),
    });
  });
  await page.getByTestId("team-invite-email").fill(pendingEmail);
  failNextTeamReload = true;
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByTestId("team-invite-link")).toBeVisible();
  await expect(page.getByTestId("team-invite-link")).toContainText(
    "Email delivery is not configured",
  );
  await expect(page.getByTestId("team-load-error")).toContainText("Temporary team reload failure");
  await page.screenshot({
    path: testInfo.outputPath("workspace-invitation-fallback.png"),
    fullPage: true,
  });
  await page.getByTestId("team-load-error").getByRole("button").click();
  const expectedReloadConsoleError = consoleErrors.findIndex((message) =>
    message.includes("503 (Service Unavailable)"),
  );
  expect(expectedReloadConsoleError).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(expectedReloadConsoleError, 1);
  const invitationCard = page
    .getByTestId("team-invitations-list")
    .locator("div.rounded-md.border")
    .filter({ hasText: pendingEmail });
  await expect(invitationCard).toContainText("Email delivery unavailable");
  await expect(invitationCard).toContainText("Resend to queue another email");
  await invitationCard.getByRole("button", { name: "Resend" }).click();
  await expect(page.getByTestId("team-error")).toContainText("invitation can be resent after");
  const expectedRateLimitConsoleError = consoleErrors.findIndex((message) =>
    message.includes("429 (Too Many Requests)"),
  );
  expect(expectedRateLimitConsoleError).toBeGreaterThanOrEqual(0);
  consoleErrors.splice(expectedRateLimitConsoleError, 1);
  await invitationCard.getByRole("button", { name: "Remove access" }).click();
  const revokeDialog = page.getByRole("dialog");
  await expect(
    revokeDialog.getByRole("heading", { name: "Cancel this invitation?" }),
  ).toBeVisible();
  await revokeDialog.getByRole("button", { name: "Remove access" }).click();
  await expect(page.getByText("Invitation canceled")).toBeVisible();
  await expect(invitationCard).toContainText("Revoked");
  await expect(invitationCard.getByRole("button", { name: "Resend" })).toHaveCount(0);

  const unauthorized = await request.patch(
    `/api/v1/workspaces/${workspace.id}/members/${adminProfile.id}`,
    {
      headers: { Authorization: `Bearer ${member.token}` },
      data: { role: "viewer" },
    },
  );
  expect(unauthorized.status()).toBe(403);

  await authenticatePage(page, member.token);
  await page.goto(`/settings?tab=members&workspace=${workspace.id}`);
  await expect(
    page.getByText(
      "You can review workspace access. Only workspace admins can invite people or change access.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("team-invite-email")).toHaveCount(0);

  await page.unroute(`**/api/v1/workspaces/${workspace.id}/team*`);
  await page.route(`**/api/v1/workspaces/${workspace.id}/team*`, async (route) => {
    const upstream = await route.fetch();
    const team = await upstream.json();
    const timestamp = new Date().toISOString();
    team.invitations.push(
      {
        id: "browser-sent",
        workspace_id: workspace.id,
        email: "provider-accepted@example.com",
        role: "viewer",
        invited_by_user_id: adminProfile.id,
        expires_at: timestamp,
        last_sent_at: timestamp,
        email_delivery_status: "sent",
        status: "sent",
        created_at: timestamp,
      },
      {
        id: "browser-delivered",
        workspace_id: workspace.id,
        email: "delivery-confirmed@example.com",
        role: "editor",
        invited_by_user_id: adminProfile.id,
        expires_at: timestamp,
        last_sent_at: timestamp,
        email_delivery_status: "delivered",
        status: "delivered",
        created_at: timestamp,
      },
    );
    await route.fulfill({ response: upstream, json: team });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Email accepted by the provider")).toBeVisible();
  await expect(page.getByText("Email delivery confirmed")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("workspace-invitation-outcomes-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByTestId("team-members-list")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("workspace-invitation-outcomes-320.png"),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});
