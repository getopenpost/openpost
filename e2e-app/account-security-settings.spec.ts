import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
} from "./helpers";

test("email change keeps the old address until confirmation and explains conflict and expiry", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const oldEmail = `email-change-${unique}@example.com`;
  const confirmedEmail = `email-confirmed-${unique}@example.com`;
  const expiredEmail = `email-expired-${unique}@example.com`;
  const auth = await registerUser(request, oldEmail);
  await createWorkspace(request, auth.token, "Email Change E2E");
  await authenticatePage(page, auth.token);

  let pending: {
    id: string;
    new_email: string;
    expires_at: string;
    sent_at: string;
  } | null = null;
  await page.route("**/api/v1/auth/email-change", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending } });
      return;
    }
    const body = route.request().postDataJSON() as { new_email: string };
    if (body.new_email === `email-conflict-${unique}@example.com`) {
      await route.fulfill({
        status: 409,
        json: { detail: "an account already uses this address" },
      });
      return;
    }
    pending = {
      id: "email-change-e2e",
      new_email: body.new_email,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      sent_at: new Date().toISOString(),
    };
    await route.fulfill({ status: 201, json: pending });
  });
  await page.route(
    "**/api/v1/auth/email-change/email-change-e2e/confirm",
    async (route) => {
      const { code } = route.request().postDataJSON() as { code: string };
      if (code === "111111") {
        await route.fulfill({
          status: 400,
          json: { detail: "invalid confirmation code" },
        });
        return;
      }
      if (code === "999999") {
        await route.fulfill({
          status: 400,
          json: { detail: "confirmation code has expired" },
        });
        return;
      }
      const email = pending?.new_email ?? confirmedEmail;
      pending = null;
      await route.fulfill({ json: { email, revoked_sessions: 1 } });
    },
  );

  await page.goto("/settings?tab=security");
  const card = page.getByTestId("email-change-card");
  await expect(card.getByText(oldEmail, { exact: true })).toBeVisible();

  await card.getByLabel("New email address").fill(confirmedEmail);
  await card.getByLabel("Current password").fill(password);
  await card.getByRole("button", { name: "Send confirmation code" }).click();
  await expect(
    card.getByText(`Waiting for confirmation of ${confirmedEmail}`),
  ).toBeVisible();
  await expect(card.getByText(oldEmail, { exact: true })).toBeVisible();

  await card.getByLabel("Confirmation code").fill("111111");
  await card.getByRole("button", { name: "Confirm email change" }).click();
  await expect(card.getByText("invalid confirmation code")).toBeVisible();
  await expect(card.getByText(oldEmail, { exact: true })).toBeVisible();

  await card.getByLabel("Confirmation code").fill("222222");
  await card.getByRole("button", { name: "Confirm email change" }).click();
  await expect(card.getByText(confirmedEmail, { exact: true })).toBeVisible();
  await expect(card.getByText(oldEmail, { exact: true })).toHaveCount(0);

  await card
    .getByLabel("New email address")
    .fill(`email-conflict-${unique}@example.com`);
  await card.getByLabel("Current password").fill(password);
  await card.getByRole("button", { name: "Send confirmation code" }).click();
  await expect(card.getByText("That address cannot be used.")).toBeVisible();
  await expect(card.getByText(confirmedEmail, { exact: true })).toBeVisible();

  await card.getByLabel("New email address").fill(expiredEmail);
  await card.getByLabel("Current password").fill(password);
  await card.getByRole("button", { name: "Send confirmation code" }).click();
  await card.getByLabel("Confirmation code").fill("999999");
  await card.getByRole("button", { name: "Confirm email change" }).click();
  await expect(card.getByText("confirmation code has expired")).toBeVisible();
  await expect(card.getByText(confirmedEmail, { exact: true })).toBeVisible();
});

test("linked identity removal keeps the final sign-in method", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `identity-guard-${unique}@example.com`;
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Identity Guard E2E");
  await authenticatePage(page, auth.token);

  await page.addInitScript(() => {
    sessionStorage.setItem(
      "openpost_reauth_grants",
      JSON.stringify({
        "identity.unlink": {
          grant: "identity-final-credential-e2e",
          expiresAt: Date.now() + 5 * 60_000,
        },
      }),
    );
  });
  await page.route("**/api/v1/auth/security", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "identity-only-user",
          email,
          username: `identity-${unique}`,
          display_name: "Only Sign-in",
          public_profile_enabled: false,
          public_profile_visible_fields: [],
          has_password: false,
          password_usable: false,
          is_managed: true,
          created_at: "2026-08-01T12:00:00Z",
        },
        totp_enabled: false,
        passkeys: [],
        methods: [],
      },
    }),
  );

  await page.route("**/api/v1/auth/oidc/identities", (route) =>
    route.fulfill({
      json: [
        {
          id: "identity-only",
          provider_id: "instance",
          provider_name: "Work account",
          linked_name: "Only Sign-in",
          linked_email: email,
          active: true,
          created_at: "2026-08-01T12:00:00Z",
          last_login_at: "2026-08-09T12:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/v1/auth/oidc/identities/identity-only", (route) =>
    route.fulfill({
      status: 400,
      json: {
        detail: "add another sign-in method before unlinking this identity",
      },
    }),
  );

  await page.goto("/settings?tab=security");
  const linkedIdentityCard = page
    .getByRole("heading", { name: "Linked identities" })
    .locator("..")
    .locator("..");
  await expect(
    linkedIdentityCard.getByText(
      "Before you continue, sign in with a passkey or a linked external account.",
    ),
  ).toBeVisible();
  await expect(linkedIdentityCard.getByLabel("Current password")).toHaveCount(
    0,
  );
  await linkedIdentityCard.getByRole("button", { name: "Unlink" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Unlink this sign-in identity?",
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Unlink" }).click();

  await expect(
    page.getByText(
      "Add another sign-in method before unlinking this identity.",
    ),
  ).toBeVisible();
  await expect(linkedIdentityCard.getByText("Only Sign-in")).toBeVisible();
});

test("API token secret is shown once with explicit expiry and status", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unique = Date.now().toString(36);
  const email = `api-token-lifecycle-${unique}@example.com`;
  const tokenName = `Account automation ${unique}`;
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "API Token Lifecycle E2E");
  await authenticatePage(page, auth.token);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/settings?tab=developer");

  const createTokenButton = page.getByRole("button", {
    name: "Create token",
  });
  await expect(createTokenButton).toBeVisible();
  await expect(createTokenButton).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.getByLabel("New token name").fill(tokenName);
  await page.getByLabel("Expiration").click();
  await page.getByRole("option", { name: "30 days" }).click();
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/api-tokens") &&
      response.request().method() === "POST",
  );
  await createTokenButton.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = (await createResponse.json()) as {
    token: string;
    item: { expires_at: string; status: string };
  };
  expect(created.item.status).toBe("active");
  const lifetime = new Date(created.item.expires_at).getTime() - Date.now();
  expect(lifetime).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  expect(lifetime).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);

  await expect(page.getByLabel("New API token")).toHaveText(created.token);
  const copyButton = page.getByRole("button", { name: "Copy", exact: true });
  await copyButton.focus();
  await expect(copyButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("region", { name: /^Notifications/ })
      .getByText("API token copied.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#tokens").getByText("API token copied.", { exact: true }),
  ).toHaveText("API token copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    created.token,
  );

  const tokenSection = page.locator("#tokens");
  await expect(
    tokenSection.getByText(tokenName, { exact: true }),
  ).toBeVisible();
  await expect(tokenSection.getByText("Active", { exact: true })).toBeVisible();
  await expect(tokenSection).toContainText("Expires");

  await page.reload();
  await expect(page.getByLabel("New API token")).toHaveCount(0);
  await expect(page.getByText(created.token, { exact: true })).toHaveCount(0);
  await expect(
    tokenSection.getByText(tokenName, { exact: true }),
  ).toBeVisible();
  const removeAccessButton = tokenSection.getByRole("button", {
    name: "Remove access",
    exact: true,
  });
  await removeAccessButton.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await expect(
    tokenSection.getByText("Revoked", { exact: true }),
  ).toBeVisible();
  await expect(removeAccessButton).toBeDisabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("profile saves private fields when public-profile capability loading fails", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `profile-capability-${unique}@example.com`;
  const displayName = `Private profile ${unique}`;
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Profile Capability E2E");
  await authenticatePage(page, auth.token);

  let capabilityAttempts = 0;
  let capabilityAvailable = false;
  await page.route("**/api/v1/auth/config", async (route) => {
    capabilityAttempts += 1;
    if (!capabilityAvailable) {
      await route.fulfill({
        status: 500,
        json: { detail: "Public-profile capability could not be loaded." },
      });
      return;
    }
    await route.fulfill({ json: { public_profiles_enabled: true } });
  });

  await page.goto("/settings?tab=profile");
  await expect(
    page.getByText("Public-profile capability could not be loaded."),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Public publishing profile",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("public-profile-preview")).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Display name", exact: true })
    .fill(displayName);
  const updateRequestPromise = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/v1/auth/profile") && req.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  const updateBody = (await updateRequestPromise).postDataJSON() as Record<
    string,
    unknown
  >;
  expect(updateBody.display_name).toBe(displayName);
  expect(updateBody).not.toHaveProperty("public_profile_enabled");
  expect(updateBody).not.toHaveProperty("public_profile_visible_fields");
  await expect(page.getByText("Profile updated")).toBeVisible();

  capabilityAvailable = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("Public publishing profile", { exact: true }),
  ).toBeVisible();
  expect(capabilityAttempts).toBeGreaterThanOrEqual(2);

  await page
    .getByRole("checkbox", { name: "Public publishing profile" })
    .check();
  const onlyAvatarVisible = [
    "Display name",
    "Join date",
    "Publishing activity and streaks",
    "Most-used platforms",
    "Most-active workspace names",
    "Plan name",
  ];
  for (const field of onlyAvatarVisible) {
    await page.getByRole("checkbox", { name: field, exact: true }).uncheck();
  }
  await page
    .getByRole("checkbox", { name: "Profile picture", exact: true })
    .check();

  const preview = page.getByTestId("public-profile-preview");
  await expect(preview.getByText(displayName, { exact: true })).toHaveCount(0);
  await expect(
    preview.getByText("Publishing activity and streaks", { exact: true }),
  ).toHaveCount(0);
  await expect(
    preview.getByText("Profile picture", { exact: true }),
  ).toBeVisible();

  const publicUpdateRequest = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/v1/auth/profile") && req.method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  expect((await publicUpdateRequest).postDataJSON()).toMatchObject({
    display_name: displayName,
    public_profile_enabled: true,
    public_profile_visible_fields: ["avatar"],
  });
});
