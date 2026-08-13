import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  authenticatePage,
  createWorkspace,
  password,
  registerUser,
} from "./helpers";

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
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
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
  await expect(
    page.getByRole("heading", { name: "Verify your identity" }),
  ).toBeVisible();
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
    if (
      message.type() === "error" &&
      !message.text().includes("status of 401")
    ) {
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
  await authenticator
    .getByRole("button", { name: "Start authenticator setup" })
    .click();

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
    async (expectedValue) =>
      (await navigator.clipboard.readText()) === expectedValue,
    manualKey,
  );
  expect(clipboardMatches).toBe(true);

  const initialCode = currentTOTP(manualKey);
  const rejectedCode = `${initialCode.startsWith("0") ? "1" : "0"}${initialCode.slice(1)}`;
  await authenticator
    .getByLabel("Enter the 6-digit code from your app")
    .fill(rejectedCode);
  await authenticator
    .getByRole("button", { name: "Verify authenticator app" })
    .click();
  await expect(
    authenticator.getByText("invalid authenticator code"),
  ).toBeVisible();
  await expect(qrCode).toBeVisible();
  expect((await manualKeyInput.inputValue()) === manualKey).toBe(true);
  // The deliberately rejected code produces the browser's expected 400 resource log.
  consoleErrors.length = 0;

  await authenticator
    .getByLabel("Enter the 6-digit code from your app")
    .fill(currentTOTP(manualKey));
  await authenticator
    .getByRole("button", { name: "Verify authenticator app" })
    .click();

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
  await recoveryPanel
    .getByRole("button", { name: "Download recovery codes" })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "openpost-recovery-codes.txt",
  );
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
  await expect(
    authenticator.getByText("Authenticator app is enabled."),
  ).toBeVisible();
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
  await expect(
    authenticator.getByText("10 recovery codes remain."),
  ).toBeVisible();

  await managementPassword.fill(password);
  await authenticator
    .getByRole("button", { name: "Generate new recovery codes" })
    .click();
  const replacementPanel = authenticator.getByTestId("recovery-code-panel");
  await expect(replacementPanel).toContainText(
    "Your existing codes remain valid until you confirm that this new set is saved.",
  );
  const replacementCodes = await replacementPanel
    .locator("code")
    .allInnerTexts();
  expect(replacementCodes).toHaveLength(10);
  expect(replacementCodes).not.toEqual(initialCodes);
  await replacementPanel
    .getByRole("checkbox", {
      name: "I saved these recovery codes in a safe place.",
    })
    .check();
  await replacementPanel
    .getByRole("button", { name: "Replace recovery codes" })
    .click();
  await expect(replacementPanel).toHaveCount(0);

  const horizontalOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(horizontalOverflow.scrollWidth).toBeLessThanOrEqual(
    horizontalOverflow.clientWidth,
  );

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
  await disableDialog
    .getByRole("button", { name: "Disable authenticator app" })
    .click();
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
  await expect(
    page.getByRole("heading", { name: "Verify your identity" }),
  ).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
