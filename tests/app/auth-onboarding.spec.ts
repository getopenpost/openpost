import { expect, test } from "@playwright/test";
import { createWorkspace, password, registerUser, routeBrowserRegistration } from "./helpers";

test("email signup confirms a six-digit code before onboarding", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = "verify-person@example.com";
  const purchaseChoiceToken = "choice-team-annual";
  const user = {
    id: "user-verified",
    email,
    email_verified: true,
    username: "verify-person",
    display_name: "verify-person",
    avatar_url: "",
    is_admin: false,
    is_managed: false,
    managed_organization_name: "",
    has_password: true,
    legal_acceptance_required: false,
    public_profile_enabled: false,
    created_at: "2026-08-03T12:00:00Z",
  };

  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: true,
        legal_acceptance_required: false,
        purchase_choice_required: true,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/providers", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/billing/purchase-choice", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      plan_id: "team",
      billing_period: "annual",
    });
    await route.fulfill({
      json: {
        token: purchaseChoiceToken,
        plan_id: "team",
        plan_name: "Team",
        billing_period: "annual",
        list_price_usd: 990,
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-12",
        expires_at: "2026-08-13T10:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/auth/register", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email,
      purchase_choice_token: purchaseChoiceToken,
    });
    await route.fulfill({
      json: {
        requires_email_verification: true,
        requires_mfa: false,
        email_verification_id: "challenge-1",
        email_verification_email: email,
        email_delivery_status: "sent",
      },
    });
  });
  let confirmationAttempts = 0;
  await page.route("**/api/v1/auth/email-verification/confirm", async (route) => {
    confirmationAttempts += 1;
    const body = route.request().postDataJSON();
    expect(body.challenge_id).toBe("challenge-1");
    if (body.code !== "654321") {
      await route.fulfill({
        status: 400,
        contentType: "application/problem+json",
        json: {
          status: 400,
          title: "Bad Request",
          detail: "verification code is incorrect",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        requires_email_verification: false,
        requires_mfa: false,
        token: "verified-session",
        user,
      },
    });
  });
  await page.route("**/api/v1/workspaces", (route) => route.fulfill({ json: [] }));

  await page.goto("/register?plan=team&billing_period=annual");
  await expect(page.getByText("OpenPost Team")).toBeVisible();
  await expect(page.getByText("$990/year", { exact: true })).toBeVisible();
  await expect(page.getByText("14-day free trial")).toBeVisible();
  await expect(page.getByText("$0 due today. A card is required at checkout.")).toBeVisible();
  await expect(page.getByText("After the trial, $990/year until canceled.")).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).searchParams.get("purchase_choice")).toBe(purchaseChoiceToken);
  await expect(page.getByText("OpenPost Team")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/verify-email\?/);
  expect(new URL(page.url()).searchParams.get("purchase_choice")).toBe(purchaseChoiceToken);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText(`Enter the 6-digit code sent to ${email}.`)).toBeVisible();
  await expect(page.getByText("OpenPost Team")).toBeVisible();
  await expect(page.getByRole("button", { name: /Send a new code in/ })).toBeDisabled();

  const verificationCode = page.getByLabel("Verification code");
  await verificationCode.fill("111111");
  expect(
    await verificationCode.evaluate((element: HTMLInputElement) => ({
      valid: element.checkValidity(),
      pattern: element.pattern,
      value: element.value,
      message: element.validationMessage,
    })),
  ).toEqual({ valid: true, pattern: "[0-9]{6}", value: "111111", message: "" });
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect.poll(() => confirmationAttempts).toBe(1);
  await expect(page.getByText("verification code is incorrect")).toBeVisible();

  await page.getByLabel("Verification code").fill("654321");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  expect(confirmationAttempts).toBe(2);
});

test("registration routes first-time users to explicit Workspace confirmation", async ({
  page,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-onboarding-${unique}@example.com`;
  await routeBrowserRegistration(page, email);
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: false,
        legal_acceptance_required: false,
        purchase_choice_required: true,
      },
    }),
  );
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
  await page.goto("/register?plan=founder&billing_period=monthly");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/onboarding\?/);
  await expect(
    page.getByRole("heading", { name: "Confirm your Workspace and plan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Workspace and continue" })).toBeDisabled();

  expect(await page.evaluate(() => window.localStorage.getItem("token"))).toBeNull();

  const workspaces = await page.context().request.get("/api/v1/workspaces");
  expect(workspaces.ok()).toBeTruthy();
  const workspaceBody = await workspaces.json();
  expect(workspaceBody).toEqual([]);
});

test("protected navigation carries its exact destination through login", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-deep-link-${unique}@example.com`;
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Deep Link E2E");

  await page.goto("/calendar?view=week");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(new URL(page.url()).searchParams.get("redirect")).toBe("/calendar?view=week");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/calendar\?view=week$/);

  await page.context().clearCookies();
  await page.goto(`/login?redirect=${encodeURIComponent("https://example.com/steal")}`);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(new URL(page.url()).origin).not.toBe("https://example.com");
});
