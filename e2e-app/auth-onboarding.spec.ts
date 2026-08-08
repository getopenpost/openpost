import { expect, test, type Route } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
  routeBrowserRegistration,
} from "./helpers";

test("email signup confirms a six-digit code before onboarding", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = "verify-person@example.com";
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
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/auth/register", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ email });
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
  await page.route(
    "**/api/v1/auth/email-verification/confirm",
    async (route) => {
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
    },
  );
  await page.route("**/api/v1/workspaces", (route) =>
    route.fulfill({ json: [] }),
  );

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/verify-email\?/);
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Enter the 6-digit code sent to ${email}.`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Send a new code in/ }),
  ).toBeDisabled();

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

test("registration routes first-time users through onboarding", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-onboarding-${unique}@example.com`;
  await routeBrowserRegistration(page, email);
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(
    /\/checkout\?plan=founder&billing_period=monthly$/,
  );

  expect(
    await page.evaluate(() => window.localStorage.getItem("token")),
  ).toBeNull();

  const workspaces = await page.context().request.get("/api/v1/workspaces");
  expect(workspaces.ok()).toBeTruthy();
  const workspaceBody = await workspaces.json();
  expect(workspaceBody).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "My workspace" })]),
  );
});

test("login honors same-origin redirects for existing workspaces", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-login-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Login Redirect E2E");

  await page.goto(
    `/login?redirect=${encodeURIComponent("/settings?tab=plan")}`,
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/settings\?tab=plan$/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
});

test("Google signup lets existing accounts resume without onboarding checkout", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-google-signup-${unique}@example.com`;
  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Existing Google Account E2E");

  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: false,
        legal_acceptance_required: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({
      json: [
        {
          id: "google",
          name: "Google",
          kind: "oauth",
          start_url: "/api/v1/auth/oidc/google/start",
        },
      ],
    }),
  );

  const destination = "/settings?tab=accounts";
  await page.goto(
    `/register?plan=founder&billing_period=annual&redirect=${encodeURIComponent(destination)}`,
  );
  const startRequestPromise = page.waitForRequest(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/v1/auth/oidc/google/start",
  );
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const startURL = new URL((await startRequestPromise).url());
  expect(startURL.searchParams.get("return_path")).toBe(
    `/onboarding?plan=founder&billing_period=annual&redirect=${encodeURIComponent(destination)}&source=signup`,
  );

  await authenticatePage(page, auth.token);
  await page.goto(startURL.searchParams.get("return_path")!);
  await expect(page).toHaveURL(/\/settings\?tab=accounts$/);
  await expect(page).not.toHaveURL(/\/checkout/);
});

test("Google signup keeps legal acceptance and onboarding in one continuation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-google-new-${unique}@example.com`;
  const auth = await registerUser(request, email);
  await authenticatePage(page, auth.token);

  let workspaceLoads = 0;
  const requireLegalAcceptance = async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      user?: Record<string, unknown>;
      legal_acceptance_required?: boolean;
    };
    await route.fulfill({
      response,
      json: body.user
        ? {
            ...body,
            user: { ...body.user, legal_acceptance_required: true },
          }
        : { ...body, legal_acceptance_required: true },
    });
  };
  await page.route("**/api/v1/auth/session-state", requireLegalAcceptance);
  await page.route("**/api/v1/auth/me", requireLegalAcceptance);
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: false,
        legal_acceptance_required: true,
        terms_url: "https://openpost.social/terms",
        privacy_url: "https://openpost.social/privacy",
      },
    }),
  );
  await page.route("**/api/v1/auth/legal-acceptance", async (route) => {
    await route.fulfill({
      json: {
        id: "user-google-new",
        email,
        username: "google-new",
        display_name: "Google New",
        avatar_url: "",
        is_admin: false,
        is_managed: false,
        managed_organization_name: "",
        has_password: false,
        legal_acceptance_required: false,
        email_verified: true,
        public_profile_enabled: false,
        created_at: "2026-08-08T10:00:00Z",
      },
    });
  });
  await page.route("**/api/v1/workspaces", async (route) => {
    if (route.request().method() === "GET") workspaceLoads += 1;
    await route.continue();
  });

  await page.goto(
    "/onboarding?plan=founder&billing_period=annual&source=signup",
  );
  await expect(page).toHaveURL(/\/legal-acceptance\?redirect=/);
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/onboarding?plan=founder&billing_period=annual&source=signup",
  );
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept and continue" }).click();

  await expect(page).toHaveURL(
    /\/checkout\?plan=founder&billing_period=annual$/,
  );
  expect(workspaceLoads).toBeLessThanOrEqual(2);
});

test("signed-in startup never mounts the login form inside the app shell", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-startup-${unique}@example.com`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, "Startup Route E2E");
  await authenticatePage(page, auth.token);
  await page.addInitScript(() => {
    const observedWindow = window as typeof window & {
      __openpostLoginShellFlash?: boolean;
    };
    observedWindow.__openpostLoginShellFlash = false;

    const detectLoginShellFlash = () => {
      if (
        document.querySelector('[data-testid="app-sidebar"]') &&
        document.querySelector("form input#email")
      ) {
        observedWindow.__openpostLoginShellFlash = true;
      }
    };

    new MutationObserver(detectLoginShellFlash).observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
      },
    );
  });

  await page.goto("/login");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __openpostLoginShellFlash?: boolean;
          }
        ).__openpostLoginShellFlash,
    ),
  ).toBe(false);
});
