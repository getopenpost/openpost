import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("workspace settings delete the active workspace and keep another", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `workspace-delete-${unique}@example.com`,
  );
  const doomed = await createWorkspace(
    request,
    auth.token,
    "Doomed Workspace",
  );
  const keeper = await createWorkspace(
    request,
    auth.token,
    "Keeper Workspace",
  );
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=general&workspace=${doomed.id}`);

  await page.getByRole("button", { name: "Delete workspace" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Delete this workspace?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete workspace" }).click();

  await expect(page).toHaveURL(/\/$/);

  const workspaces = await request.get(`/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(workspaces.ok()).toBeTruthy();
  const body = await workspaces.json();
  expect(body.map((workspace: { id: string }) => workspace.id)).toContain(
    keeper.id,
  );
  expect(body.map((workspace: { id: string }) => workspace.id)).not.toContain(
    doomed.id,
  );
});

test("workspace settings warn before leaving and save the shared workspace color", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `workspace-settings-${unique}@example.com`,
  );
  const workspace = await createWorkspace(
    request,
    auth.token,
    "Workspace Settings E2E",
  );
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/settings?tab=general&workspace=${workspace.id}`);

  await page.getByRole("button", { name: "Workspace color" }).click();
  await page.getByLabel("Hex color").fill("#2563EB");
  await page.getByLabel("Hex color").press("Enter");

  const warning = page.waitForEvent("dialog");
  const attemptedNavigation = page
    .getByRole("button", { name: "Calendar", exact: true })
    .click();
  const dialog = await warning;
  expect(dialog.message()).toContain("unsaved settings");
  await dialog.dismiss();
  await attemptedNavigation;
  await expect(page).toHaveURL(/\/settings\?tab=general/);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved successfully")).toBeVisible();

  const response = await request.get(
    `/api/v1/workspaces/${workspace.id}/settings`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).color).toBe("#2563eb");

  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar/);
});
