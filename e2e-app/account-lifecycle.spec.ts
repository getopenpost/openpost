import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, password, registerUser } from "./helpers";

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
