import { expect, test } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
  routeBrowserRegistration,
} from "./helpers";

const hostedAuthConfiguration = {
  registration_enabled: true,
  password_reset_enabled: true,
  email_verification_required: false,
  legal_acceptance_required: true,
  terms_url: "https://openpost.social/terms",
  privacy_url: "https://openpost.social/privacy",
  terms_version: "2026-07-22",
  privacy_version: "2026-07-22",
  support_email: "openpost@rgo.pt",
};

test("hosted registration requires current legal acceptance", async ({
  page,
}) => {
  const unique = Date.now().toString(36);
  const email = `legal-registration-${unique}@example.com`;
  await routeBrowserRegistration(page, email);
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: hostedAuthConfiguration }),
  );
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  const submit = page.getByRole("button", { name: "Create Account" });
  await expect(submit).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Terms of Service" }),
  ).toHaveAttribute("href", hostedAuthConfiguration.terms_url);
  await expect(
    page.getByRole("link", { name: "Privacy Policy" }),
  ).toHaveAttribute("href", hostedAuthConfiguration.privacy_url);

  await page.getByRole("checkbox").check();
  const registrationRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/v1/auth/register") &&
      request.method() === "POST",
  );
  await submit.click();
  expect((await registrationRequest).postDataJSON()).toMatchObject({
    email,
    accepted_legal: true,
  });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Confirm your Workspace and plan" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Choose a plan and billing period before creating your account.",
    ),
  ).toBeVisible();
});

test("password recovery keeps the token out of browser history and uses generic confirmation", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({ json: hostedAuthConfiguration }),
  );
  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "person@example.com",
    });
    await route.fulfill({
      json: {
        message:
          "If an account exists for that email, a password reset link has been sent.",
      },
    });
  });

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("person@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();

  const resetToken = "a".repeat(43);
  const replacementPassword = "replacement-password-456";
  await page.route("**/api/v1/auth/password-reset/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token: resetToken,
      new_password: replacementPassword,
    });
    await route.fulfill({ json: { message: "Password reset." } });
  });
  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page
    .getByLabel("New password", { exact: true })
    .fill(replacementPassword);
  await page.getByLabel("Confirm new password").fill(replacementPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password reset" }),
  ).toBeVisible();
});

test("users can change passwords, export data, and permanently delete their account", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `account-lifecycle-${unique}@example.com`;
  const replacementPassword = "replacement-password-456";
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Account Lifecycle E2E");
  await authenticatePage(page, auth.token);
  await page.goto("/settings?tab=security");

  await expect(
    page.getByRole("heading", { name: "Password and account data" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Change password/ })
    .first()
    .click();
  await page.locator("#account-current-password").fill(password);
  await page.locator("#account-new-password").fill(replacementPassword);
  await page.locator("#account-confirm-password").fill(replacementPassword);
  await page
    .locator("form")
    .filter({ has: page.locator("#account-current-password") })
    .getByRole("button", { name: "Change password" })
    .click();
  await expect(page.getByText(/Password changed\./)).toBeVisible();

  await page
    .getByRole("button", { name: /Download your data/ })
    .first()
    .click();
  await page.locator("#export-password").fill(replacementPassword);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON export" }).click();
  await expect((await download).suggestedFilename()).toMatch(
    /^openpost-account-export-\d{4}-\d{2}-\d{2}\.json$/,
  );
  await expect(
    page.getByText("Your account export was downloaded."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Review account deletion" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Permanently delete your account?",
  });
  await expect(dialog).toBeVisible();
  const deleteButton = dialog.getByRole("button", {
    name: "Delete account permanently",
  });
  await expect(deleteButton).toBeDisabled();
  await dialog.getByLabel("Type your account email to confirm").fill(email);
  await dialog.getByLabel("Current password").fill(replacementPassword);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page).toHaveURL(/\/account-deleted$/);
  await expect(
    page.getByRole("heading", { name: "Your account was deleted" }),
  ).toBeVisible();

  const me = await page.context().request.get("/api/v1/auth/me");
  expect(me.status()).toBe(401);
});
