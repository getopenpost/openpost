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
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({ json: [] }),
  );
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

  await page.goto("/register?plan=team&billing_period=annual");
  await expect(page.getByText("OpenPost Team")).toBeVisible();
  await expect(page.getByText("$990/year", { exact: true })).toBeVisible();
  await expect(page.getByText("14-day free trial")).toBeVisible();
  await expect(
    page.getByText("$0 due today. A card is required at checkout."),
  ).toBeVisible();
  await expect(
    page.getByText("After the trial, $990/year until canceled."),
  ).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).searchParams.get("purchase_choice")).toBe(
    purchaseChoiceToken,
  );
  await expect(page.getByText("OpenPost Team")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/verify-email\?/);
  expect(new URL(page.url()).searchParams.get("purchase_choice")).toBe(
    purchaseChoiceToken,
  );
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Enter the 6-digit code sent to ${email}.`),
  ).toBeVisible();
  await expect(page.getByText("OpenPost Team")).toBeVisible();
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

test("registration presents every canonical plan and billing period without a fallback", async ({
  page,
}) => {
  const prices = {
    starter: { monthly: 15, annual: 150, name: "Starter" },
    founder: { monthly: 25, annual: 250, name: "Founder" },
    pro: { monthly: 49, annual: 490, name: "Pro" },
    team: { monthly: 99, annual: 990, name: "Team" },
    agency: { monthly: 199, annual: 1990, name: "Agency" },
  } as const;
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
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/billing/purchase-choice", async (route) => {
    const body = route.request().postDataJSON() as {
      plan_id: keyof typeof prices;
      billing_period: "monthly" | "annual";
    };
    const plan = prices[body.plan_id];
    await route.fulfill({
      json: {
        token: `choice-${body.plan_id}-${body.billing_period}`,
        plan_id: body.plan_id,
        plan_name: plan.name,
        billing_period: body.billing_period,
        list_price_usd: plan[body.billing_period],
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-12",
        expires_at: "2026-08-13T10:00:00Z",
      },
    });
  });

  for (const [planID, plan] of Object.entries(prices)) {
    for (const period of ["monthly", "annual"] as const) {
      await page.goto(`/register?plan=${planID}&billing_period=${period}`);
      await expect(page.getByText(`OpenPost ${plan.name}`)).toBeVisible();
      const periodLabel = period === "annual" ? "/year" : "/month";
      await expect(
        page.getByText(
          `$${plan[period].toLocaleString("en-US")}${periodLabel}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          `After the trial, $${plan[period].toLocaleString("en-US")}${periodLabel} until canceled.`,
        ),
      ).toBeVisible();
    }
  }
});

test("registration rejects missing invalid expired and mismatched choices", async ({
  page,
}) => {
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
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/billing/purchase-choice", async (route) => {
    const token = route.request().postDataJSON().purchase_choice_token;
    const code = token === "expired" ? "expired" : "mismatch";
    const detail =
      code === "expired"
        ? "purchase choice has expired"
        : "purchase choice does not match the selected plan and billing period";
    await route.fulfill({
      status: 400,
      contentType: "application/problem+json",
      json: {
        type: `urn:openpost:problem:purchase-choice:${code}`,
        status: 400,
        title: "Invalid purchase choice",
        detail,
      },
    });
  });

  await page.goto("/register");
  await expect(
    page.getByText(
      "Choose a plan and billing period before creating your account.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose a plan again" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Account" }),
  ).toBeDisabled();

  await page.goto("/register?plan=enterprise&billing_period=monthly");
  await expect(
    page.getByText("This plan choice is not valid. Choose a plan again."),
  ).toBeVisible();

  await page.goto(
    "/register?plan=founder&billing_period=monthly&purchase_choice=expired",
  );
  await expect(
    page.getByText(
      "This plan choice expired. Choose a plan again to continue.",
    ),
  ).toBeVisible();

  await page.goto(
    "/register?plan=founder&billing_period=monthly&purchase_choice=mismatched",
  );
  await expect(
    page.getByText(
      "The plan details changed during signup. Choose the plan again to continue.",
    ),
  ).toBeVisible();
});

test("registration routes first-time users to explicit Workspace confirmation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `auth-onboarding-${unique}@example.com`;
  await routeBrowserRegistration(page, email);
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
  await expect(
    page.getByRole("button", { name: "Create Workspace and continue" }),
  ).toBeDisabled();

  expect(
    await page.evaluate(() => window.localStorage.getItem("token")),
  ).toBeNull();

  const workspaces = await page.context().request.get("/api/v1/workspaces");
  expect(workspaces.ok()).toBeTruthy();
  const workspaceBody = await workspaces.json();
  expect(workspaceBody).toEqual([]);
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
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/settings\?tab=plan$/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
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
  expect(new URL(page.url()).searchParams.get("redirect")).toBe(
    "/calendar?view=week",
  );
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/calendar\?view=week$/);

  await page.context().clearCookies();
  await page.goto(
    `/login?redirect=${encodeURIComponent("https://example.com/steal")}`,
  );
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(new URL(page.url()).origin).not.toBe("https://example.com");
});

test("password controls expose the real rules without losing entered values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/v1/auth/config", (route) =>
    route.fulfill({
      json: {
        registration_enabled: true,
        password_reset_enabled: true,
        email_verification_required: false,
        legal_acceptance_required: false,
        purchase_choice_required: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/oidc/providers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      json: {
        status: 401,
        title: "Unauthorized",
        detail: "invalid credentials",
      },
    }),
  );

  await page.goto("/login");
  const loginEmail = page.getByLabel("Email", { exact: true });
  const loginPassword = page.getByLabel("Password", { exact: true });
  await loginEmail.fill("person@example.com");
  await loginPassword.fill("entered-password");

  const showLoginPassword = page.getByRole("button", { name: "Show password" });
  await showLoginPassword.focus();
  await expect(showLoginPassword).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Hide password" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(loginPassword).toHaveAttribute("type", "text");
  await expect(loginPassword).toHaveValue("entered-password");

  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByText("invalid credentials")).toBeVisible();
  await expect(loginEmail).toHaveValue("person@example.com");

  await page.goto("/register");
  await expect(page.getByText("At least 12 characters")).toBeVisible();
  await expect(page.getByText("No more than 1,024 characters")).toBeVisible();
  await expect(page.getByText("Both password fields match")).toBeVisible();

  const registrationPassword = page.getByLabel("Password", { exact: true });
  const confirmation = page.getByLabel("Confirm Password");
  await registrationPassword.fill(password);
  await confirmation.fill(password);
  await expect(
    page.getByText("Both password fields match").locator(".."),
  ).toContainText("Satisfied:");

  const revealButtons = page.getByRole("button", { name: "Show password" });
  await expect(revealButtons).toHaveCount(2);
  await revealButtons.last().click();
  await expect(confirmation).toHaveAttribute("type", "text");
  await expect(confirmation).toHaveValue(password);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
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
        purchase_choice_required: true,
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
  await page.route("**/api/v1/billing/purchase-choice", (route) =>
    route.fulfill({
      json: {
        token: "choice-founder-annual",
        plan_id: "founder",
        plan_name: "Founder",
        billing_period: "annual",
        list_price_usd: 250,
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-12",
        expires_at: "2026-08-13T10:00:00Z",
      },
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
  expect(startURL.searchParams.get("signup")).toBe("true");
  expect(startURL.searchParams.get("plan_id")).toBe("founder");
  expect(startURL.searchParams.get("billing_period")).toBe("annual");
  expect(startURL.searchParams.get("purchase_choice_token")).toBe(
    "choice-founder-annual",
  );
  expect(startURL.searchParams.get("return_path")).toBe(
    `/onboarding?plan=founder&billing_period=annual&purchase_choice=choice-founder-annual&redirect=${encodeURIComponent(destination)}&source=signup`,
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
  await page.route("**/api/v1/billing/purchase-choice", (route) =>
    route.fulfill({
      json: {
        token: "choice-founder-annual",
        plan_id: "founder",
        plan_name: "Founder",
        billing_period: "annual",
        list_price_usd: 250,
        trial_days: 14,
        card_required: true,
        due_today_usd: 0,
        catalog_version: "2026-08-12",
        expires_at: "2026-08-13T10:00:00Z",
      },
    }),
  );
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

  await expect(page).toHaveURL(/\/onboarding\?/);
  await expect(
    page.getByRole("heading", { name: "Confirm your Workspace and plan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Workspace name")).toBeVisible();
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
