import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("accepted invitations retry workspace refresh without consuming the token again", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(request, `invite-refresh-recovery-${unique}@example.com`);
  const workspace = (await createWorkspace(request, auth.token, "Invite Refresh Recovery E2E")) as {
    id: string;
  };
  await authenticatePage(page, auth.token);

  // Invitation refresh goes through app bootstrap, not the workspaces list.
  // The initial page-load bootstrap carries no preference and must pass;
  // only the refresh (preferred_workspace_id set) fails until retried.
  // Both the initial attempt and its one automatic retry fail so the error
  // surfaces instead of being absorbed.
  let allowWorkspaceRefresh = false;
  await page.route("**/api/v1/app/bootstrap?**", async (route) => {
    const preferred = new URL(route.request().url()).searchParams.get("preferred_workspace_id");
    if (!preferred || allowWorkspaceRefresh) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      json: { title: "Unavailable", status: 503 },
    });
  });

  let acceptanceRequests = 0;
  await page.route("**/api/v1/workspace-invitations/accept", async (route) => {
    acceptanceRequests++;
    await route.fulfill({
      contentType: "application/json",
      json: { workspace_id: workspace.id, role: "editor" },
    });
  });

  await page.goto("/invite?token=consumed-token");

  await expect(page.getByRole("heading", { level: 1, name: "Invitation accepted" })).toBeVisible();
  await expect(page.getByTestId("invite-error")).toHaveCount(0);
  const refreshError = page.getByTestId("invite-workspace-refresh-error");
  await expect(refreshError).toContainText(
    "You joined the workspace, but OpenPost could not refresh your workspace list.",
  );
  await expect(page.getByRole("link", { name: "Open Workspace" })).toHaveCount(0);

  allowWorkspaceRefresh = true;
  await refreshError.getByRole("button", { name: "Try again" }).click();

  await expect(refreshError).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Workspace" })).toBeVisible();
  expect(acceptanceRequests).toBe(1);
});
