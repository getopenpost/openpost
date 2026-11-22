import { expect, test, type Page } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
  routeBrowserRegistration,
} from "./helpers";
import { createHmac, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test.describe("account lifecycle", () => {
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

    await expect(page.getByRole("heading", { name: "Password and account data" })).toBeVisible();
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
    await expect(page.getByText("Your account export was downloaded.")).toBeVisible();

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
    await expect(page.getByRole("heading", { name: "Your account was deleted" })).toBeVisible();

    const me = await page.context().request.get("/api/v1/auth/me");
    expect(me.status()).toBe(401);
  });
});

test.describe("auth onboarding", () => {
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
          list_price_usd: 590,
          trial_days: 14,
          card_required: true,
          due_today_usd: 0,
          catalog_version: "2026-09-08",
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
    await expect(page.getByText("$590/year", { exact: true })).toBeVisible();
    await expect(page.getByText("14-day free trial")).toBeVisible();
    await expect(page.getByText("$0 due today. A card is required at checkout.")).toBeVisible();
    await expect(page.getByText("After the trial, $590/year until canceled.")).toBeVisible();
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
          plan_name: "Solo",
          billing_period: "monthly",
          list_price_usd: 29,
          trial_days: 14,
          card_required: true,
          due_today_usd: 0,
          catalog_version: "2026-09-08",
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
    await expect(page).toHaveURL(/\/publications$/);
    expect(new URL(page.url()).origin).not.toBe("https://example.com");
  });
});

test.describe("mfa recovery", () => {
  const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function decodeBase32(value: string): Buffer {
    let bits = "";
    for (const character of value.replace(/=+$/u, "").toUpperCase()) {
      const index = base32Alphabet.indexOf(character);
      if (index < 0) throw new Error("Invalid Base32 setup value");
      bits += index.toString(2).padStart(5, "0");
    }

    const bytes: number[] = [];
    for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
      bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
    }
    return Buffer.from(bytes);
  }

  function currentTOTP(secret: string): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
    const offset = digest.at(-1)! & 0x0f;
    const value =
      (((digest[offset]! & 0x7f) << 24) |
        ((digest[offset + 1]! & 0xff) << 16) |
        ((digest[offset + 2]! & 0xff) << 8) |
        (digest[offset + 3]! & 0xff)) %
      1_000_000;
    return value.toString().padStart(6, "0");
  }

  async function beginPasswordMFA(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByRole("heading", { name: "Verify your identity" })).toBeVisible();
  }

  async function openRecoveryCodeForm(page: Page) {
    await page.getByRole("button", { name: "Use a recovery code" }).click();
    await expect(page.getByLabel("Recovery code")).toBeVisible();
  }

  async function clearSession(page: Page) {
    await page.waitForLoadState("networkidle");
    await page.context().clearCookies();
  }

  test("recovery codes gate authenticator setup, replace exactly once, and recover sign-in", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("status of 401")) {
        consoleErrors.push(`${page.url()}: ${message.text()}`);
      }
    });

    const unique = Date.now().toString(36);
    const email = `mfa-recovery-${unique}@example.com`;
    const auth = await registerUser(request, email);
    await createWorkspace(request, auth.token, "MFA Recovery E2E");
    await authenticatePage(page, auth.token);
    await page.goto("/settings?tab=security");

    const authenticator = page.getByTestId("authenticator-security-card");
    const setupSteps = authenticator.getByTestId("totp-setup-steps");
    await expect(setupSteps.locator("li")).toHaveCount(6);
    await expect(setupSteps).toContainText(
      "Verify your identity with your current password or another sign-in method.",
    );
    await expect(setupSteps).toContainText(
      "Save the one-time recovery codes somewhere separate from your authenticator.",
    );
    await authenticator.getByLabel("Current password").fill(password);
    await authenticator.getByRole("button", { name: "Start authenticator setup" }).click();

    await expect(
      authenticator.getByText(
        "Keep this page open. You can switch to your authenticator app and return without losing this setup.",
      ),
    ).toBeVisible();
    const qrCode = authenticator.getByTestId("totp-setup-qr-code");
    await expect(qrCode).toHaveAttribute("src", /^data:image\/png;base64,/u);
    const qrCodeBounds = await qrCode.boundingBox();
    expect((qrCodeBounds?.width ?? 0) >= 220).toBe(true);
    expect((qrCodeBounds?.height ?? 0) >= 220).toBe(true);

    const manualKeyInput = authenticator.getByTestId("totp-manual-entry-key");
    const manualKey = await manualKeyInput.inputValue();
    expect(manualKey.length > 0).toBe(true);
    await authenticator.getByRole("button", { name: "Copy setup key" }).click();
    await expect(authenticator.getByText("Setup key copied.")).toBeVisible();
    const clipboardMatches = await page.evaluate(
      async (expectedValue) => (await navigator.clipboard.readText()) === expectedValue,
      manualKey,
    );
    expect(clipboardMatches).toBe(true);

    const initialCode = currentTOTP(manualKey);
    const rejectedCode = `${initialCode.startsWith("0") ? "1" : "0"}${initialCode.slice(1)}`;
    await authenticator.getByLabel("Enter the 6-digit code from your app").fill(rejectedCode);
    await authenticator.getByRole("button", { name: "Verify authenticator app" }).click();
    await expect(authenticator.getByText("invalid authenticator code")).toBeVisible();
    await expect(qrCode).toBeVisible();
    expect((await manualKeyInput.inputValue()) === manualKey).toBe(true);
    // The deliberately rejected code produces the browser's expected 400 resource log.
    consoleErrors.length = 0;

    await authenticator
      .getByLabel("Enter the 6-digit code from your app")
      .fill(currentTOTP(manualKey));
    await authenticator.getByRole("button", { name: "Verify authenticator app" }).click();

    const recoveryPanel = authenticator.getByTestId("recovery-code-panel");
    await expect(recoveryPanel).toBeVisible();
    await expect(
      recoveryPanel.getByText(
        "These codes are shown only once. Copy or download them now and store them somewhere you can reach if you lose your authenticator.",
      ),
    ).toBeVisible();
    const initialCodes = await recoveryPanel.locator("code").allInnerTexts();
    expect(initialCodes).toHaveLength(10);

    const enableAuthenticator = recoveryPanel.getByRole("button", {
      name: "Enable authenticator app",
    });
    await expect(enableAuthenticator).toBeDisabled();
    const download = page.waitForEvent("download");
    await recoveryPanel.getByRole("button", { name: "Download recovery codes" }).click();
    expect((await download).suggestedFilename()).toBe("openpost-recovery-codes.txt");
    await expect(enableAuthenticator).toBeDisabled();

    const savedAcknowledgement = recoveryPanel.getByRole("checkbox", {
      name: "I saved these recovery codes in a safe place.",
    });
    await savedAcknowledgement.focus();
    await page.keyboard.press("Space");
    await expect(savedAcknowledgement).toBeChecked();
    await expect(enableAuthenticator).toBeEnabled();
    await enableAuthenticator.click();
    await expect(recoveryPanel).toHaveCount(0);
    await expect(authenticator.getByText("Authenticator app is enabled.")).toBeVisible();
    await expect(
      authenticator.getByText(
        "Your authenticator app is now an enabled sign-in factor. Password sign-ins require its six-digit code or a one-time recovery code.",
      ),
    ).toBeVisible();

    const managementPassword = authenticator.getByLabel("Current password");
    const checkRemaining = authenticator.getByRole("button", {
      name: "Check remaining codes",
    });
    await expect(checkRemaining).toBeDisabled();
    await managementPassword.fill(password);
    await checkRemaining.click();
    await expect(authenticator.getByText("10 recovery codes remain.")).toBeVisible();

    await managementPassword.fill(password);
    await authenticator.getByRole("button", { name: "Generate new recovery codes" }).click();
    const replacementPanel = authenticator.getByTestId("recovery-code-panel");
    await expect(replacementPanel).toContainText(
      "Your existing codes remain valid until you confirm that this new set is saved.",
    );
    const replacementCodes = await replacementPanel.locator("code").allInnerTexts();
    expect(replacementCodes).toHaveLength(10);
    expect(replacementCodes).not.toEqual(initialCodes);
    await replacementPanel
      .getByRole("checkbox", {
        name: "I saved these recovery codes in a safe place.",
      })
      .check();
    await replacementPanel.getByRole("button", { name: "Replace recovery codes" }).click();
    await expect(replacementPanel).toHaveCount(0);

    await clearSession(page);
    await beginPasswordMFA(page, email);
    await openRecoveryCodeForm(page);
    await page.getByLabel("Recovery code").fill(initialCodes[0]!);
    await page.getByRole("button", { name: "Verify recovery code" }).click();
    await expect(page.getByText("invalid recovery code")).toBeVisible();
    await page.getByLabel("Recovery code").fill(replacementCodes[0]!);
    await page.getByRole("button", { name: "Verify recovery code" }).click();
    await expect(page).toHaveURL(/\/$/u);

    await clearSession(page);
    await beginPasswordMFA(page, email);
    await openRecoveryCodeForm(page);
    await page.getByLabel("Recovery code").fill(replacementCodes[0]!);
    await page.getByRole("button", { name: "Verify recovery code" }).click();
    await expect(page.getByText("invalid recovery code")).toBeVisible();
    await page.getByLabel("Recovery code").fill(replacementCodes[1]!);
    await page.getByRole("button", { name: "Verify recovery code" }).click();
    await expect(page).toHaveURL(/\/$/u);

    await page.goto("/settings?tab=security");
    const enabledAuthenticator = page.getByTestId("authenticator-security-card");
    const disableAuthenticator = enabledAuthenticator.getByRole("button", {
      name: "Disable authenticator app",
    });
    await expect(disableAuthenticator).toBeDisabled();
    await enabledAuthenticator.getByLabel("Current password").fill(password);
    await disableAuthenticator.click();
    const disableDialog = page.getByRole("dialog", {
      name: "Disable the authenticator app?",
    });
    await expect(disableDialog).toBeVisible();
    await disableDialog.getByRole("button", { name: "Disable authenticator app" }).click();
    await expect(
      enabledAuthenticator.getByRole("button", {
        name: "Start authenticator setup",
      }),
    ).toBeVisible();

    await clearSession(page);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByRole("heading", { name: "Verify your identity" })).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("hosted waitlist", () => {
  test.describe("light", () => {
    test.use({ hasTouch: false });
    test(`Hosted waitlist handles retries and signup at phone and desktop widths in light`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.route("**/api/v1/auth/config", (route) =>
        route.fulfill({
          json: {
            waitlist_enabled: true,
            registration_enabled: false,
            purchase_choice_required: true,
            legal_acceptance_required: true,
            email_verification_required: true,
            privacy_url: "https://openpo.st/privacy",
          },
        }),
      );
      // The waitlist must still work when optional identity providers are unavailable.
      await page.route("**/api/v1/auth/oidc/providers", (route) =>
        route.fulfill({ status: 503, json: {} }),
      );
      let attempts = 0;
      const unexpected: string[] = [];
      page.on("request", (request) => {
        if (
          /\/api\/v1\/(billing\/purchase-choice|auth\/(register|email-verification))/.test(
            request.url(),
          )
        ) {
          unexpected.push(request.url());
        }
      });
      await page.route("**/api/v1/auth/waitlist", (route) => {
        expect(route.request().postDataJSON()).toEqual({ email: "waitlist@example.com" });
        attempts += 1;
        return route.fulfill(
          attempts === 1
            ? { status: 503, json: { detail: "unavailable" } }
            : { json: { joined: true } },
        );
      });

      await page.goto("/register?plan=founder&billing_period=monthly&redirect=%2Fimage-editor");
      await expect(
        page.getByRole("heading", { name: "OpenPost Cloud is almost ready" }),
      ).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);

      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeVisible();

      const accessibility = await new AxeBuilder({ page }).include("main").analyze();
      expect(accessibility.violations).toEqual([]);

      const email = page.getByRole("textbox", { name: "Email", exact: true });
      await email.fill("invalid");
      await email.press("Enter");
      expect(attempts).toBe(0);
      await email.fill("waitlist@example.com");
      await email.press("Tab");
      await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toContainText("We couldn't save your email");
      await expect(email).toHaveValue("waitlist@example.com");
      await page.getByRole("button", { name: "Join the waitlist" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "You're on the list" }),
      ).toBeVisible();
      await expect(email).toHaveCount(0);
      expect(attempts).toBe(2);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      await page.getByRole("link", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/login\?redirect=%2Fimage-editor$/);
      await expect(page.getByRole("link", { name: "Join the waitlist" })).toBeVisible();
    });
  });
});

test.describe("profile signed in action", () => {
  test.use({ serviceWorkers: "block" });

  test("public profile header sends signed-in viewers to their own profile settings", async ({
    page,
    request,
  }) => {
    const owner = await registerUser(request, `profile-owner-${randomUUID()}@example.com`);
    await createWorkspace(request, owner.token, "Profile owner");
    const headers = { Authorization: `Bearer ${owner.token}` };
    expect(
      (
        await request.patch("/api/v1/auth/profile", {
          headers,
          data: {
            display_name: "Audit public owner",
            public_profile_enabled: true,
            public_profile_visible_fields: ["display_name"],
          },
        })
      ).ok(),
    ).toBe(true);
    const identity = await (await request.get("/api/v1/auth/me", { headers })).json();
    const viewer = await registerUser(request, `profile-viewer-${randomUUID()}@example.com`);
    await createWorkspace(request, viewer.token, "Profile viewer");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const actor of [owner, viewer]) {
      const actorIdentity = await (
        await request.get("/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${actor.token}` },
        })
      ).json();
      await authenticatePage(page, actor.token);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`/u/${identity.username}`);
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Audit public owner", exact: true }),
      ).toBeVisible();
      const action = page.locator("header").getByRole("link", { name: "Profile", exact: true });
      await expect(action).toHaveAttribute("href", "/settings?tab=profile");
      await expect(
        page.getByRole("link", { name: "Create your profile", exact: true }),
      ).toHaveCount(0);
      await action.focus();
      await expect(action).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/settings\?tab=profile$/);
      const me = await (await page.request.get("/api/v1/auth/me")).json();
      expect(me.id).toBe(actorIdentity.id);
    }
    await page.context().clearCookies();
    await page.goto(`/u/${identity.username}`);
    await expect(
      page.getByRole("heading", { name: "Audit public owner", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("header").getByRole("link", { name: "Create your profile", exact: true }),
    ).toHaveAttribute("href", "/register");
    await expect(
      page.locator("header").getByRole("link", { name: "Profile", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "calm");
    expect(errors).toEqual([]);
  });
});

test.describe("ownership transfer invalid link", () => {
  test("an incomplete transfer keeps its explanation and never retries an absent ID", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `invalid-transfer-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "Invalid Transfer");
    await authenticatePage(page, auth.token);
    const resolves: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("organization-ownership-transfers/resolve"))
        resolves.push(request.url());
    });
    await page.goto("/ownership-transfer");
    {
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate((value) => localStorage.setItem("mode-watcher-mode", value), "light");
      await page.reload();
      const explanation = page.getByText("This ownership-transfer link is incomplete.", {
        exact: true,
      });
      await expect(explanation).toBeVisible();
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      if (await retry.count()) await retry.click();
      await expect(explanation).toBeVisible();
      await expect(retry).toHaveCount(0);
      const recovery = page.getByRole("link", { name: "Return to OpenPost", exact: true });
      await recovery.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
      await page.goto("/ownership-transfer");
    }
    expect(resolves).toEqual([]);
    const transferID = randomUUID();
    await page.route("**/api/v1/organization-ownership-transfers/resolve?**", (route) =>
      route.fulfill({ status: 503, json: { detail: "Temporary local transfer failure" } }),
    );
    await page.goto(`/ownership-transfer?id=${transferID}`);
    await expect(page.getByText("Temporary local transfer failure", { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => resolves.length).toBe(2);
    expect(resolves.every((url) => new URL(url).searchParams.get("id") === transferID)).toBe(true);
  });
});

test.describe("organization ownership", () => {
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
    const invitationResponse = await request.post(
      `/api/v1/workspaces/${workspace.id}/invitations`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
        data: { email: nomineeEmail, role: "viewer" },
      },
    );
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
    await expect(page.getByRole("button", { name: "Nominate successor" })).toBeVisible();
    await page.getByLabel("Successor").click();
    await page.getByRole("option", { name: new RegExp(nomineeEmail) }).click();
    await page
      .getByLabel("Enter Ownership browser proof to confirm")
      .fill("Ownership browser proof");
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
});

test.describe("organization sso read state", () => {
  test("SSO empty reads settle and failed reads do not advertise empty configuration", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `sso-read-${randomUUID()}@example.com`);
    await createWorkspace(request, auth.token, "SSO read states");
    await authenticatePage(page, auth.token);
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/settings?tab=sso");
    await expect(page.locator('[data-slot="page-content"]').first()).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      page.getByText("No work sign-in services have been added.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No identity events have been recorded.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await page.route("**/api/v1/organizations/*/identity-audit-events*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({ status: 500, detail: "Audit temporarily unavailable" }),
      }),
    );
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("Audit temporarily unavailable");
    await expect(
      page.getByText("No work sign-in services have been added.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No identity events have been recorded.", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/v1/organizations/*/identity-audit-events*");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      page.getByText("No identity events have been recorded.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("destructive operations", () => {
  // The create/switch selection races behind the 2026-09-03 skip were fixed by
  // decoupling workspace selection from dialog mount state
  // (create-workspace-dialog.svelte) and by taking the refresh-only path for
  // stale implicit bootstraps (workspace.svelte.ts). Re-enabled to prove the
  // delete-active-workspace selection handoff end to end.
  test("workspace settings delete the active workspace and keep another", async ({
    page,
    request,
  }) => {
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `workspace-delete-${unique}@example.com`);
    const doomed = await createWorkspace(request, auth.token, "Doomed Workspace");
    const keeperResponse = await request.post("/api/v1/workspaces", {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { name: "Keeper Workspace", organization_id: doomed.organization_id },
    });
    expect(keeperResponse.ok()).toBeTruthy();
    const keeper = await keeperResponse.json();
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/settings?tab=general&workspace=${doomed.id}`);

    const renameResponse = await request.patch(`/api/v1/workspaces/${doomed.id}/settings`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: { name: "Canonical Workspace" },
    });
    expect(renameResponse.ok()).toBeTruthy();

    await page.getByText("Danger zone", { exact: true }).click();
    await page.getByRole("button", { name: "Delete workspace" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete this workspace?" })).toBeVisible();
    await expect(dialog.getByText("Removed permanently")).toBeVisible();
    await expect(dialog.getByText("Retained records")).toBeVisible();
    await expect(
      dialog.getByText("This Workspace cannot be recovered after deletion."),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await dialog.getByLabel("Enter Canonical Workspace exactly").fill("Canonical Workspace");
    await dialog.getByLabel("Current password").fill("wrong-password");
    await dialog.getByRole("button", { name: "Delete workspace" }).click();
    await expect(dialog.getByText("recent reauthentication is required")).toBeVisible();
    await expect(dialog.getByLabel("Enter Canonical Workspace exactly")).toHaveValue(
      "Canonical Workspace",
    );
    await expect(dialog).toBeVisible();
    expect(new URL(page.url()).searchParams.get("workspace")).toBe(doomed.id);

    const retainedAfterFailure = await request.get(`/api/v1/workspaces`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(
      (await retainedAfterFailure.json()).map((workspace: { id: string }) => workspace.id),
    ).toContain(doomed.id);

    await dialog.getByLabel("Current password").fill(password);
    await dialog.getByRole("button", { name: "Delete workspace" }).click();

    await expect(page).toHaveURL(/\/$/);

    const workspaces = await request.get(`/api/v1/workspaces`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(workspaces.ok()).toBeTruthy();
    const body = await workspaces.json();
    expect(body.map((workspace: { id: string }) => workspace.id)).toContain(keeper.id);
    expect(body.map((workspace: { id: string }) => workspace.id)).not.toContain(doomed.id);
  });

  test("Organization Owner reviews and permanently deletes the complete Organization", async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const unique = Date.now().toString(36);
    const auth = await registerUser(request, `organization-delete-${unique}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Organization Deletion E2E");
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/settings?tab=ownership&workspace=${workspace.id}`);

    await page.getByRole("button", { name: "Delete Organization" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete this Organization?" })).toBeVisible();
    await expect(dialog.getByText("Organization Deletion E2E", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Billing state: No subscription")).toBeVisible();
    await expect(dialog.getByText("Provider writes: 0")).toBeVisible();
    await expect(dialog.getByText("Other external jobs: 0")).toBeVisible();
    await expect(dialog.getByText("Cleanup jobs: 0")).toBeVisible();
    await expect(dialog.getByText("Access removed")).toBeVisible();
    await expect(dialog.getByText("Organization membership for every member")).toBeVisible();
    await expect(
      dialog.getByText("Posts, drafts, schedules, analytics, and messages"),
    ).toBeVisible();
    await expect(
      dialog.getByText("Minimum audit evidence without deleted content or credentials"),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    await expect(dialog.getByText(/cannot be recovered/)).toBeVisible();
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Enter Organization Deletion E2E exactly")
      .fill("Organization Deletion E2E");
    await dialog.getByLabel("Current password").fill("wrong-password");
    const rejectedDeletion = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/api/v1/organizations/${workspace.organization_id}`),
    );
    await dialog.getByRole("button", { name: "Delete Organization" }).click();
    expect((await rejectedDeletion).status()).toBe(401);
    await expect(dialog.getByText("recent reauthentication is required")).toBeVisible();
    expect(consoleErrors).toEqual([
      "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    ]);
    consoleErrors.length = 0;
    await dialog.getByLabel("Current password").fill(password);
    await dialog.getByRole("button", { name: "Delete Organization" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    const organizations = await request.get("/api/v1/organizations", {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(organizations.ok()).toBeTruthy();
    expect((await organizations.json()).map((item: { id: string }) => item.id)).not.toContain(
      workspace.organization_id,
    );
    expect(consoleErrors).toEqual([]);
  });
});
