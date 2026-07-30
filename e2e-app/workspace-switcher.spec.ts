import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("sidebar footer switches between workspaces", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `workspace-switcher-${unique}@example.com`;
  const firstName = `Launch ${unique}`;
  const secondName = `Client ${unique}`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, firstName);
  await createWorkspace(request, auth.token, secondName);

  await authenticatePage(page, auth.token);
  await page.goto("/");

  const workspaceNames = [firstName, secondName];
  const workspaceNamePattern = new RegExp(workspaceNames.join("|"));
  const workspaceButton = page
    .getByRole("button", { name: workspaceNamePattern })
    .first();
  await expect(workspaceButton).toBeVisible();
  const buttonText = await workspaceButton.innerText();
  const activeWorkspace = workspaceNames.find((name) =>
    buttonText.includes(name),
  );
  expect(activeWorkspace).toBeTruthy();
  const nextWorkspace = activeWorkspace === firstName ? secondName : firstName;

  await workspaceButton.click();
  await expect(page.getByText("Switch workspace")).toBeVisible();
  await page.getByRole("menuitem", { name: new RegExp(nextWorkspace) }).click();

  await expect(workspaceButton).toContainText(nextWorkspace);
});

test("workspace switcher creates and selects a workspace", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `workspace-create-${unique}@example.com`;
  const firstName = `Personal ${unique}`;
  const newName = `Project ${unique}`;

  const auth = await registerUser(request, email);
  await createWorkspace(request, auth.token, firstName);

  await authenticatePage(page, auth.token);
  await page.goto("/");

  const workspaceButton = page
    .getByRole("button", { name: new RegExp(`${firstName}|${newName}`) })
    .first();
  await expect(workspaceButton).toBeVisible();

  await workspaceButton.click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create workspace" }),
  ).toBeVisible();
  await dialog.getByLabel("Workspace name").fill(newName);

  const createResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/workspaces" &&
      response.request().method() === "POST"
    );
  });
  await dialog.getByRole("button", { name: "Create workspace" }).click();
  expect((await createResponse).ok()).toBe(true);

  await expect(dialog).toBeHidden();
  await expect(workspaceButton).toContainText(newName);

  await workspaceButton.click();
  await expect(
    page.getByRole("menuitem", { name: new RegExp(newName) }),
  ).toBeVisible();
});

test("workspace-scoped pages reload when the sidebar workspace changes", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const email = `workspace-pages-${unique}@example.com`;
  const auth = await registerUser(request, email);
  const first = (await createWorkspace(
    request,
    auth.token,
    `Editorial ${unique}`,
  )) as { id: string; name: string };
  const second = (await createWorkspace(
    request,
    auth.token,
    `Campaign ${unique}`,
  )) as { id: string; name: string };

  await authenticatePage(page, auth.token);
  await page.goto("/accounts");

  const workspaces = [first, second];
  const workspaceButton = page
    .getByRole("button", {
      name: new RegExp(workspaces.map((workspace) => workspace.name).join("|")),
    })
    .first();
  await expect(workspaceButton).toBeVisible();

  const activeText = await workspaceButton.innerText();
  const active = workspaces.find((workspace) =>
    activeText.includes(workspace.name),
  );
  expect(active).toBeTruthy();
  const next = active?.id === first.id ? second : first;

  const accountsRequest = page.waitForRequest((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/accounts" &&
      url.searchParams.get("workspace_id") === next.id
    );
  });
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(next.name) }).click();
  await accountsRequest;
  await expect(workspaceButton).toContainText(next.name);

  await page.goto("/activity");
  await expect(workspaceButton).toContainText(next.name);
  const previous = next.id === first.id ? second : first;
  const publicationsRequest = page.waitForRequest((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/publications" &&
      url.searchParams.get("workspace_id") === previous.id
    );
  });
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(previous.name) }).click();
  await publicationsRequest;
  await expect(workspaceButton).toContainText(previous.name);
});

test("a slow previous-workspace response cannot replace current account data", async ({
  page,
  request,
}) => {
  const unique = Date.now().toString(36);
  const auth = await registerUser(
    request,
    `workspace-race-${unique}@example.com`,
  );
  const first = (await createWorkspace(
    request,
    auth.token,
    `Slow ${unique}`,
  )) as { id: string; name: string };
  const second = (await createWorkspace(
    request,
    auth.token,
    `Fast ${unique}`,
  )) as { id: string; name: string };

  await authenticatePage(page, auth.token);
  await page.addInitScript((workspace) => {
    localStorage.setItem(
      "openpost_current_workspace",
      JSON.stringify(workspace),
    );
  }, first);
  let releaseSlowResponse = () => {};
  const slowResponseGate = new Promise<void>((resolve) => {
    releaseSlowResponse = resolve;
  });
  let slowRequestStarted = false;
  let markSlowRequestFinished = () => {};
  const slowRequestFinished = new Promise<void>((resolve) => {
    markSlowRequestFinished = resolve;
  });
  await page.route("**/api/v1/accounts?**", async (route) => {
    const workspaceId = new URL(route.request().url()).searchParams.get(
      "workspace_id",
    );
    if (workspaceId === first.id) {
      slowRequestStarted = true;
      await slowResponseGate;
    }
    const isCurrent = workspaceId === second.id;
    await route.fulfill({
      contentType: "application/json",
      json: [
        {
          id: isCurrent ? "fast-account" : "slow-account",
          workspace_id: workspaceId,
          platform: "bluesky",
          account_id: isCurrent ? "did:plc:fast" : "did:plc:slow",
          account_username: isCurrent ? "fast_current" : "slow_previous",
          is_active: true,
        },
      ],
    });
    if (workspaceId === first.id) markSlowRequestFinished();
  });

  await page.goto("/accounts");
  const workspaceButton = page
    .getByRole("button", { name: new RegExp(first.name) })
    .first();
  await expect(workspaceButton).toBeVisible();
  await expect.poll(() => slowRequestStarted).toBe(true);
  await workspaceButton.click();
  await page.getByRole("menuitem", { name: new RegExp(second.name) }).click();

  await expect(page.getByText("@fast_current")).toBeVisible();
  releaseSlowResponse();
  await slowRequestFinished;
  await expect(page.getByText("@fast_current")).toBeVisible();
  await expect(page.getByText("@slow_previous")).toHaveCount(0);
});
