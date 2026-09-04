import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, password, registerUser } from "./helpers";

// Ownership transfer is a destructive, irreversible operation. This test
// proves the full journey against the real backend: the owner nominates a
// successor with password reauthentication, the transfer stays pending with
// the owner still in charge, and the nominee's acceptance flips the roles.
test("owner nominates a successor and acceptance flips the roles", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `ownership-${unique}@example.com`);
  const nomineeEmail = `ownership-nominee-${unique}@example.com`;
  const nomineeAuth = await registerUser(request, nomineeEmail);
  const workspace = await createWorkspace(request, auth.token, "Ownership browser proof");
  const me = await (
    await request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
  ).json();
  const nominee = await (
    await request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${nomineeAuth.token}` },
    })
  ).json();
  const organizationID = workspace.organization_id;
  const invitationResponse = await request.post(`/api/v1/workspaces/${workspace.id}/invitations`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { email: nomineeEmail, role: "viewer" },
  });
  expect(invitationResponse.ok()).toBeTruthy();
  const invitation = await invitationResponse.json();
  const invitationToken = new URL(invitation.accept_url).searchParams.get("token");
  expect(invitationToken).toBeTruthy();
  const acceptanceResponse = await request.post("/api/v1/workspace-invitations/accept", {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
    data: { token: invitationToken },
  });
  expect(acceptanceResponse.ok()).toBeTruthy();
  const removalResponse = await request.delete(
    `/api/v1/workspaces/${workspace.id}/members/${nominee.id}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(removalResponse.ok()).toBeTruthy();
  await page.route(`**/api/v1/organizations/${organizationID}/team`, (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        members: [
          { user_id: me.id, email: me.email, role: "owner" },
          { user_id: nominee.id, email: nomineeEmail, role: "member" },
        ],
        current_seats: 2,
      },
    }),
  );
  await page.route("**/api/v1/auth/security", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        user: { password_usable: true },
        passkeys: [],
        totp_enabled: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/identities", (route) =>
    route.fulfill({ contentType: "application/json", json: [] }),
  );
  await page.route("**/api/v1/workspaces", (route) =>
    route.fulfill({ contentType: "application/json", json: [] }),
  );
  await page.route("**/api/v1/organizations", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: organizationID,
          name: "Ownership browser proof",
          role: "owner",
          created_at: "2026-08-14T12:00:00Z",
        },
      ],
    }),
  );
  await authenticatePage(page, auth.token);
  await page.goto(`/settings?tab=ownership&organization=${organizationID}`);
  await expect(page.getByRole("heading", { name: "Ownership", level: 1 })).toBeVisible();
  await page.getByLabel("Successor").click();
  await page.getByRole("option", { name: new RegExp(nomineeEmail) }).click();
  await page.getByLabel("Enter Ownership browser proof to confirm").fill("Ownership browser proof");
  await page.getByLabel("Current password").fill(password);
  const passwordReauth = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/reauth/password",
  );
  const ownershipInitiation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/organizations/${organizationID}/ownership-transfer`,
  );
  await page.getByRole("button", { name: "Nominate successor" }).click();
  expect((await passwordReauth).ok()).toBeTruthy();
  expect((await ownershipInitiation).ok()).toBeTruthy();
  await expect(page.getByText("Ownership transfer pending")).toBeVisible();
  await expect(page.getByText(/You remain Owner until acceptance/)).toBeVisible();
  expect(browserErrors).toEqual([]);

  const transferResponse = await request.get(
    `/api/v1/organizations/${organizationID}/ownership-transfer`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(transferResponse.ok()).toBeTruthy();
  const ownershipState = await transferResponse.json();
  expect(ownershipState.pending).toBe(true);
  const transfer = ownershipState.transfer;

  await authenticatePage(page, nomineeAuth.token);
  await page.goto(`/ownership-transfer?id=${transfer.id}`);
  await expect(page.getByText(/nominated you to become the only Owner/)).toBeVisible();
  await page.getByRole("button", { name: "Accept ownership" }).click();
  await expect(page.getByText(/prior Owner is now an Administrator/)).toBeVisible();
  const acceptedTeamResponse = await request.get(`/api/v1/organizations/${organizationID}/team`, {
    headers: { Authorization: `Bearer ${nomineeAuth.token}` },
  });
  expect(acceptedTeamResponse.ok()).toBeTruthy();
  const acceptedTeam = await acceptedTeamResponse.json();
  expect(acceptedTeam.members).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ user_id: nominee.id, role: "owner" }),
      expect.objectContaining({ user_id: me.id, role: "admin" }),
    ]),
  );
  expect(browserErrors).toEqual([]);
});
