import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type Feature = "messaging" | "engagement" | "analytics" | "grow";

function featureResponse(
  workspaceID: string,
  accountID: string,
  feature: Feature,
  stored: boolean,
  enabled: boolean,
) {
  return {
    workspace_id: workspaceID,
    social_account_id: accountID,
    platform: "x",
    feature,
    supported: true,
    availability: "available",
    reason_code: "available",
    required_scopes: [],
    missing_scopes: [],
    unavailable_reason: "",
    stored_exists: stored,
    stored_enabled: enabled,
    effective_enabled: stored && enabled,
  };
}

test("Social accounts settings owns account feature choices", async ({ page, request }) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `account-features-${unique}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Account features");
  await authenticatePage(page, auth.token);

  const accountID = "account-details";
  const account = {
    id: accountID,
    platform: "x",
    account_username: "detailuser",
    slug: "detail",
    messaging_supported: true,
    messages_enabled: false,
    is_active: true,
    instance_url: "",
    account_id: accountID,
    account_avatar_url: "",
    grant_destination_count: 1,
    shared_grant: false,
    thread_replies_supported: true,
  };
  let features = [
    featureResponse(workspace.id, accountID, "messaging", true, true),
    featureResponse(workspace.id, accountID, "engagement", true, false),
    featureResponse(workspace.id, accountID, "analytics", false, false),
    featureResponse(workspace.id, accountID, "grow", true, true),
  ];

  await page.route("**/api/v1/accounts?*", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [account] });
  });
  await page.route(`**/api/v1/accounts/${accountID}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ contentType: "application/json", json: account });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/account-features*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: features });
      return;
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        choices: Array<{ feature: Feature; enabled: boolean }>;
      };
      features = features.map((current) => {
        const choice = body.choices.find((candidate) => candidate.feature === current.feature);
        return choice
          ? {
              ...current,
              stored_exists: true,
              stored_enabled: choice.enabled,
              effective_enabled: choice.enabled,
            }
          : current;
      });
      await route.fulfill({ contentType: "application/json", json: features });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/v1/accounts/providers*", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.goto("/settings?tab=accounts");
  await page
    .getByTestId(`account-card-${accountID}`)
    .getByRole("button", { name: /Actions for/ })
    .click();
  await page.getByRole("menuitem", { name: "Details" }).click();

  const dialog = page.getByRole("dialog", { name: "Account details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Direct messages")).toBeChecked();
  await expect(dialog.getByLabel("Comments and replies")).not.toBeChecked();
  await expect(dialog.getByLabel("Analytics")).not.toBeChecked();

  await dialog.getByLabel("Analytics").check();
  await dialog.getByLabel("Direct messages").uncheck();
  await dialog.getByRole("button", { name: "Save details" }).click();

  await expect(dialog).toHaveCount(0);
  expect(features.find((feature) => feature.feature === "analytics")?.stored_enabled).toBe(true);
  expect(features.find((feature) => feature.feature === "messaging")?.stored_enabled).toBe(false);
});
