import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const pageErrors = new WeakMap<import("@playwright/test").Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function openWorkflows(page: import("@playwright/test").Page) {
  const { token } = await registerUser(
    page.request,
    `workflows-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
  );
  const workspace = await createWorkspace(page.request, token, "Workflow studio");
  await authenticatePage(page, token);
  await page.goto("/workflows");
  await expect(page.getByRole("button", { name: "New workflow", exact: true })).toBeVisible({
    timeout: 30000,
  });
  return { token, workspace };
}

test("workflow editor saves, previews without writes, and approves a native draft", async ({
  page,
}) => {
  const { token, workspace } = await openWorkflows(page);
  const headers = { Authorization: `Bearer ${token}` };
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Release announcement");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("option", { name: "Create draft", exact: true }).click();
  await page
    .getByLabel("Post text", { exact: true })
    .fill("Shipping {{source.title}}: {{source.body}}");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("option", { name: "Review post", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const editorURL = page.url();
  await page.reload();
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "Release announcement",
  );
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  await page.getByLabel("Title", { exact: true }).fill("version 2");
  await page.getByLabel("Post text", { exact: true }).fill("Smaller daily tasks.");
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Cancel run", exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.getByText("This is a preview.", { exact: false })).toBeVisible();
  const publications = await page.request.get(`/api/v1/publications?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(publications.ok()).toBeTruthy();
  expect(await publications.json()).toEqual([]);
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  await page.getByText("Live", { exact: true }).click();
  await page.getByRole("button", { name: "Run live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve shown revision", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("main").getByText("Shipping version 2: Smaller daily tasks.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve shown revision", exact: true }).click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Cancel run", exact: true })).toHaveCount(0, {
    timeout: 30000,
  });
  const livePublications = await page.request.get(
    `/api/v1/publications?workspace_id=${workspace.id}`,
    { headers },
  );
  expect(await livePublications.json()).toHaveLength(1);
  await expect(
    page
      .getByTestId("sidebar-draft-list")
      .getByText("Shipping version 2: Smaller daily tasks.", { exact: true }),
  ).toBeVisible();
  await page.goto(editorURL);
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "Release announcement",
  );
  await page.getByRole("button", { name: "Publish workflow", exact: true }).click();
  await page.getByRole("button", { name: "Pause new runs", exact: true }).click();
  await page.getByRole("link", { name: "All workflows", exact: true }).click();
  await page.getByRole("button", { name: "Delete: Release announcement", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("link", { name: /Release announcement/ })).toHaveCount(0);
  await expect(
    page
      .getByTestId("sidebar-draft-list")
      .getByText("Shipping version 2: Smaller daily tasks.", { exact: true }),
  ).toBeVisible();
});

test("a failed source sample keeps the saved editor usable", async ({ page }) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "Start from a template", exact: true }).first().click();
  await page.getByRole("button", { name: "Use template", exact: true }).first().click();
  await page.getByLabel("GitHub repository", { exact: true }).fill("getopenpost/openpost");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.route("**/workflow-sources/sample?*", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/problem+json",
      body: JSON.stringify({
        title: "Source unavailable",
        status: 422,
        detail: "GitHub is unavailable. Try again.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  await page.getByRole("button", { name: "Fetch an example", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub is unavailable");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Recovered release workflow");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "Recovered release workflow",
  );
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
]) {
  test(`workflow templates and keyboard configuration at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkflows(page);
    await page.getByRole("button", { name: "Start from a template", exact: true }).first().click();
    await page.getByRole("button", { name: "Use template", exact: true }).first().click();
    await page.getByLabel("GitHub repository", { exact: true }).fill("openpost/openpost");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Steps", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Post text", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `test-results/workflows-light-${viewport.width}.png`,
      fullPage: true,
    });
    if (viewport.width < 1024)
      await page.getByRole("button", { name: "Show canvas", exact: true }).click();
    await expect(page.getByLabel("Workflow canvas", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem("mode-watcher-mode", "dark");
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.reload();
    if (viewport.width < 1024)
      await page.getByRole("button", { name: "Show canvas", exact: true }).click();
    await expect(
      page
        .getByLabel("Workflow canvas", { exact: true })
        .getByRole("button", { name: "GitHub release Source" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `test-results/workflows-dark-${viewport.width}.png`,
      fullPage: true,
    });
  });
}

test("workflow guest entry requires sign-in", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page.getByRole("button", { name: "New workflow", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
});

test("workspace viewers can inspect but cannot change workflows", async ({ page, request }) => {
  const { token, workspace } = await openWorkflows(page);
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Read-only flow",
      expected_revision: 0,
      description: "",
      definition: { schema: 1, source: { kind: "manual" }, steps: [] },
    },
  });
  expect(created.ok()).toBeTruthy();
  const workflow = await created.json();
  const email = `workflow-viewer-${Date.now()}@example.com`;
  const viewer = await registerUser(request, email);
  const invitation = await request.post(`/api/v1/workspaces/${workspace.id}/invitations`, {
    headers,
    data: { email, role: "viewer" },
  });
  expect(invitation.ok()).toBeTruthy();
  const invitationToken = new URL((await invitation.json()).accept_url).searchParams.get("token");
  const viewerHeaders = { Authorization: `Bearer ${viewer.token}` };
  const accepted = await request.post("/api/v1/workspace-invitations/accept", {
    headers: viewerHeaders,
    data: { token: invitationToken },
  });
  expect(accepted.ok()).toBeTruthy();
  await page.context().clearCookies();
  await authenticatePage(page, viewer.token);
  await page.goto(`/workflows/${workflow.id}`);
  await expect(page.getByLabel("Workflow name", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add step", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish workflow", exact: true })).toBeDisabled();
  const apiDenied = await request.post(
    `/api/v1/workflows/${workflow.id}/publish?workspace_id=${workspace.id}`,
    { headers: viewerHeaders, data: { expected_revision: workflow.revision } },
  );
  expect(apiDenied.status()).toBe(403);
});

test.describe("workflow touch controls", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("configuration keeps primary controls at touch size", async ({ page }) => {
    await openWorkflows(page);
    await page.getByRole("button", { name: "New workflow", exact: true }).click();
    for (const label of ["Add step", "Steps", "Publish workflow", "Preview"]) {
      const control = page.getByRole("button", { name: label, exact: true }).first();
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Show canvas", exact: true }).click();
    const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
    await expect(zoom).toBeVisible();
    expect((await zoom.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
});
