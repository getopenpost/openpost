import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

type AccountFixture = {
  id: string;
  grantKey: string;
  workspace_id: string;
  platform: string;
  account_id: string;
  account_username: string;
  is_active: boolean;
  slug: string;
  thread_replies_supported: boolean;
  messaging_supported: boolean;
  messages_enabled: boolean;
  grant_destination_count: number;
  shared_grant: boolean;
};

test("accounts distinguishes destination disconnect from credential revocation", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `account-grants-${unique}@example.com`,
  );
  const workspace = (await createWorkspace(
    request,
    auth.token,
    "Grant Actions E2E",
  )) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  let accounts: AccountFixture[] = [
    accountFixture(workspace.id, "shared-a", "shared_a", "grant-one", 2),
    accountFixture(workspace.id, "shared-b", "shared_b", "grant-one", 2),
    accountFixture(workspace.id, "shared-c", "shared_c", "grant-two", 2),
    accountFixture(workspace.id, "shared-d", "shared_d", "grant-two", 2),
    accountFixture(workspace.id, "solo", "solo", "grant-solo", 1),
  ];
  const deletePaths: string[] = [];

  await page.route("**/api/v1/accounts/**", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const path = new URL(route.request().url()).pathname;
    deletePaths.push(path);
    const pathParts = path.split("/");
    const accountID =
      pathParts.at(-1) === "grant" ? pathParts.at(-2) : pathParts.at(-1);
    const target = accounts.find((account) => account.id === accountID);
    if (target && path.endsWith("/grant")) {
      accounts = accounts.filter(
        (account) => account.grantKey !== target.grantKey,
      );
    } else if (target) {
      accounts = accounts.filter((account) => account.id !== target.id);
      const remaining = accounts.filter(
        (account) => account.grantKey === target.grantKey,
      ).length;
      accounts = accounts.map((account) =>
        account.grantKey === target.grantKey
          ? {
              ...account,
              grant_destination_count: remaining,
              shared_grant: remaining > 1,
            }
          : account,
      );
    }
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: accounts.map(({ grantKey: _grantKey, ...account }) => account),
    });
  });
  await page.route("**/api/v1/accounts/providers", async (route) => {
    await route.fulfill({ contentType: "application/json", json: [] });
  });

  await page.goto("/settings?tab=accounts");

  await openAccountMenu(page, "shared-a", "@shared_a");
  let menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Disconnect this destination" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", {
      name: "Remove saved authorization for 2 destinations",
    }),
  ).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Disconnect this destination" })
    .click();

  let dialog = page.getByRole("dialog", { name: "Disconnect @shared_a?" });
  await expect(dialog).toContainText("@shared_a is one of 2 destinations");
  await expect(dialog).toContainText("every other destination stays connected");
  await dialog
    .getByRole("button", { name: "Disconnect this destination" })
    .click();
  await expect.poll(() => deletePaths).toContain("/api/v1/accounts/shared-a");
  await expect(page.getByTestId("account-card-shared-a")).toHaveCount(0);
  await expect(page.getByTestId("account-card-shared-b")).toBeVisible();

  await openAccountMenu(page, "shared-c", "@shared_c");
  menu = page.getByRole("menu");
  await menu
    .getByRole("menuitem", {
      name: "Remove saved authorization for 2 destinations",
    })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Remove the saved authorization for 2 destinations?",
  });
  await expect(dialog).toContainText("delete its saved provider credentials");
  await expect(dialog).toContainText("disconnect all 2 destinations");
  await expect(dialog).toContainText(
    "does not disable the credential at LinkedIn",
  );
  await dialog
    .getByRole("button", { name: "Remove saved authorization" })
    .click();
  await expect
    .poll(() => deletePaths)
    .toContain("/api/v1/accounts/shared-c/grant");
  await expect(page.getByTestId("account-card-shared-c")).toHaveCount(0);
  await expect(page.getByTestId("account-card-shared-d")).toHaveCount(0);

  await openAccountMenu(page, "solo", "@solo");
  menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Remove connection" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Disconnect this destination" }),
  ).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Remove connection" }).click();
  dialog = page.getByRole("dialog", { name: "Remove @solo?" });
  await expect(dialog).toContainText(
    "delete its saved provider credentials and disconnect @solo",
  );
  await expect(dialog).toContainText(
    "does not disable the credential at LinkedIn",
  );
  await dialog.getByRole("button", { name: "Remove connection" }).click();
  await expect.poll(() => deletePaths).toContain("/api/v1/accounts/solo/grant");
  await expect(page.getByTestId("account-card-solo")).toHaveCount(0);
});

function accountFixture(
  workspaceID: string,
  id: string,
  username: string,
  grantKey: string,
  grantDestinationCount: number,
): AccountFixture {
  return {
    id,
    grantKey,
    workspace_id: workspaceID,
    platform: "linkedin",
    account_id: `urn:li:organization:${id}`,
    account_username: username,
    is_active: true,
    slug: id,
    thread_replies_supported: true,
    messaging_supported: false,
    messages_enabled: false,
    grant_destination_count: grantDestinationCount,
    shared_grant: grantDestinationCount > 1,
  };
}

async function openAccountMenu(
  page: import("@playwright/test").Page,
  accountID: string,
  accountName: string,
) {
  await page
    .getByTestId(`account-card-${accountID}`)
    .getByRole("button", { name: `Actions for ${accountName}` })
    .click();
}
