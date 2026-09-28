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

async function addStep(page: import("@playwright/test").Page, name: string) {
  const close = page.getByRole("button", {
    name: "Back to canvas",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page
    .getByRole("complementary", { name: "What happens next?" })
    .getByRole("button", { name: new RegExp("^" + name) })
    .click();
}
async function releaseTemplate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Start from a template", exact: true }).first().click();
  await page
    .getByRole("heading", { name: "Announce a GitHub release", exact: true })
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Use template", exact: true })
    .click();
  await page.getByRole("button", { name: /^Needs attention/ }).click();
}

test("workflow editor saves, previews without writes, and approves a native draft", async ({
  page,
}) => {
  const { token, workspace } = await openWorkflows(page);
  const headers = { Authorization: `Bearer ${token}` };
  const completedRun = page.getByRole("paragraph").filter({ hasText: /^Completed$/ });
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByLabel("Workflow name", { exact: true }).fill("Release announcement");
  await addStep(page, "Create draft");
  await page
    .getByLabel("Post text", { exact: true })
    .fill("Shipping {{source.title}}: {{source.body}}");
  await addStep(page, "Review post");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const editorURL = page.url();
  await page.reload();
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "Release announcement",
  );
  await expect(page.getByTestId("sidebar-draft-list")).toHaveCount(0);
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.getByLabel("Sample input (JSON)", { exact: true }).fill(
    JSON.stringify({
      title: "version 2",
      body: "Smaller daily tasks.",
      url: "https://example.com",
    }),
  );
  await page.getByRole("button", { name: "Run preview", exact: true }).last().click();
  await expect(completedRun).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("This is a preview.", { exact: false })).toBeVisible();
  const publications = await page.request.get(`/api/v1/publications?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(publications.ok()).toBeTruthy();
  expect(await publications.json()).toEqual([]);
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.getByText("Live", { exact: true }).click();
  await page.getByRole("button", { name: "Run live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve shown revision", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("main").getByText("Shipping version 2: Smaller daily tasks.", { exact: true }),
  ).toBeVisible();
  await expect(completedRun).toHaveCount(0);
  await page.getByRole("button", { name: "Approve shown revision", exact: true }).click();
  await expect(completedRun).toBeVisible({
    timeout: 30000,
  });
  const livePublications = await page.request.get(
    `/api/v1/publications?workspace_id=${workspace.id}`,
    { headers },
  );
  expect(await livePublications.json()).toHaveLength(1);
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
  await releaseTemplate(page);
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
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.getByRole("button", { name: "Fetch an example", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub is unavailable");
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
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
    await releaseTemplate(page);
    await page.getByLabel("GitHub repository", { exact: true }).fill("openpost/openpost");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Steps", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Post text", { exact: true })).toBeVisible();
    const inspector = page.getByRole("dialog");
    await expect(inspector).toBeVisible();
    await page.getByRole("button", { name: "Steps", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeVisible();
    const bounds = await inspector.boundingBox();
    expect(bounds?.width).toBeGreaterThan(viewport.width * 0.9);
    if (viewport.width >= 1024) {
      expect(bounds?.x).toBeGreaterThan(0);
      expect(bounds?.y).toBeGreaterThan(0);
    }
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
    if (await page.getByRole("button", { name: "Back to canvas", exact: true }).isVisible())
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect(page.getByLabel("Workflow canvas", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem("mode-watcher-mode", "dark");
    });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.reload();
    if (await page.getByRole("button", { name: "Back to canvas", exact: true }).isVisible())
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect(
      page
        .getByLabel("Workflow canvas", { exact: true })
        .getByRole("button", { name: "GitHub release Trigger" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `test-results/workflows-dark-${viewport.width}.png`,
      fullPage: true,
    });
    const sourceNode = page.getByRole("button", {
      name: "GitHub release Trigger",
      exact: true,
    });
    await sourceNode.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const backdrop = await page.locator('[data-slot="dialog-overlay"]').evaluate((overlay) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const before = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      context.fillStyle = getComputedStyle(overlay).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const after = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      return { before, after };
    });
    expect(Math.max(...backdrop.before)).toBeGreaterThan(0);
    expect(backdrop.after.reduce((sum, value) => sum + value, 0)).toBeLessThan(
      backdrop.before.reduce((sum, value) => sum + value, 0),
    );
    await page.screenshot({
      path: `test-results/workflows-dark-modal-${viewport.width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(sourceNode).toBeFocused();
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
    for (const label of ["Add step", "Editor", "Publish workflow", "Run preview"]) {
      const control = page.getByRole("button", { name: label, exact: true }).first();
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
    await expect(zoom).toBeVisible();
    expect((await zoom.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await addStep(page, "Create draft");
    await page.getByRole("button", { name: "Output", exact: true }).click();
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
    const draftNode = page.getByRole("button", { name: "Create draft Create draft", exact: true });
    await expect(draftNode).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
    await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
    await draftNode.click();
    await expect(page.getByLabel("Post text", { exact: true })).toBeVisible();
  });
});

test("node testing preserves structured variables and leaves later steps untouched", async ({
  page,
}) => {
  const { token, workspace } = await openWorkflows(page);
  const created = await page.request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "Data tools",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "shape",
            kind: "code",
            name: "Shape items",
            inputs: {
              data: { literal: [] },
              code: { literal: "return { items: input };" },
            },
          },
          {
            id: "count",
            kind: "code",
            name: "Count articles",
            inputs: {
              data: { reference: "shape.data.items" },
              code: { literal: "return input.length;" },
            },
          },
          {
            id: "combine",
            kind: "code",
            name: "Combine results",
            inputs: {
              data: {
                literal: {
                  first: "{{shape.data.items.0.title}}",
                  count: "{{count.data}}",
                },
              },
              code: { literal: "return input.first + ': ' + input.count;" },
            },
          },
          {
            id: "draft",
            kind: "create_draft",
            name: "Unfinished draft",
            inputs: { text: { literal: "" } },
          },
        ],
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  const workflow = await created.json();
  await page.goto(`/workflows/${workflow.id}`);
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.getByLabel("Sample input (JSON)", { exact: true }).fill(
    JSON.stringify({
      items: [{ title: "First article" }, { title: "Second article" }],
    }),
  );
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: "Shape items JavaScript", exact: true }).click();
  await page.getByLabel("Data", { exact: true }).fill("{{source.items}}");
  await expect(page.getByRole("button", { name: "Data", exact: true })).toContainText(
    "Source: items",
  );
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await expect(output.getByText("First article", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await output.getByRole("button", { name: "Table", exact: true }).click();
  await expect(output.getByRole("cell", { name: "First article", exact: true })).toBeVisible();
  await expect(output.getByRole("cell", { name: "Second article", exact: true })).toBeVisible();
  for (const [name, expected] of [
    ["Count articles", "2"],
    ["Combine results", "First article: 2"],
  ]) {
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: `${name} JavaScript`, exact: true }).click();
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await expect(output.getByText(expected, { exact: true })).toBeVisible({
      timeout: 30000,
    });
  }
  await page
    .getByLabel("JavaScript", { exact: true })
    .fill('throw new Error("Cannot format this article");');
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect(output.getByRole("alert")).toContainText("Cannot format this article", {
    timeout: 30000,
  });
  const posts = await page.request.get(`/api/v1/publications?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await posts.json()).toEqual([]);
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Needs attention/ }).click();
  await expect(page.getByLabel("Post text", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("missing source variables mark both the field and its canvas node", async ({ page }) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await addStep(page, "Create draft");
  for (const reference of ["source.missing", "source.rendition_id"]) {
    await page.getByLabel("Post text", { exact: true }).fill(`{{${reference}}}`);
    await expect
      .soft(page.getByLabel("Post text", { exact: true }))
      .toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect
      .soft(page.getByRole("button", { name: /^Create draft.*Needs attention/ }))
      .toBeVisible();
    await page
      .getByRole("button", { name: /^Create draft/ })
      .first()
      .click();
  }
  await page.getByLabel("Post text", { exact: true }).fill("{{source.title}}");
  await expect(page.getByLabel("Post text", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Needs attention/ })).toHaveCount(0);
});

test("inserting a variable preserves JSON and its nested outputs remain usable", async ({
  page,
}) => {
  const { token, workspace } = await openWorkflows(page);
  const created = await page.request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: "Nested content",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "fields",
            kind: "set_fields",
            name: "Content fields",
            inputs: { fields: { literal: { metadata: { tag: "" } } } },
          },
          {
            id: "draft",
            kind: "create_draft",
            name: "Announcement",
            inputs: { text: { literal: "{{fields.metadata.tag}}" } },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const workflow = await created.json();
  await page.goto(`/workflows/${workflow.id}`);
  await page.getByRole("button", { name: "Content fields Edit fields", exact: true }).click();
  const fields = page.getByRole("textbox", {
    name: "Fields (JSON)",
    exact: true,
  });
  await fields.fill('{"metadata":{"tag":""}}');
  await fields.press("End");
  await fields.press("ArrowLeft");
  await fields.press("ArrowLeft");
  await fields.press("ArrowLeft");
  await page.getByRole("button", { name: "Insert variable", exact: true }).click();
  await page
    .getByRole("option", {
      name: /(?:Source: title|source.title)/,
      exact: true,
    })
    .click();
  await expect(fields).toBeVisible();
  await page.getByRole("button", { name: "Edit variable syntax", exact: true }).click();
  await expect(fields).toHaveText('{"metadata":{"tag":"{{source.title}}"}}');
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Output", exact: true })
      .getByText("A new release", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Announcement/ }).click();
  await expect(page.getByLabel("Post text", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Completed$/ })).toBeVisible({
    timeout: 30000,
  });
});

test("connections keep saved secrets hidden and allow replacement", async ({ page }) => {
  await openWorkflows(page);
  await page.goto("/workflows/connections");
  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  await page.getByLabel("Connection name", { exact: true }).fill("Release API");
  await page.getByLabel("Secret value", { exact: true }).fill("example-test-secret");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Release API", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("example-test-secret", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Replace secret", exact: true }).click();
  await expect(page.getByLabel("Secret value", { exact: true })).toHaveValue("");
  await page.getByLabel("Secret value", { exact: true }).fill("replacement-test-secret");
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Release API", exact: true })).toBeVisible();
  await expect(page.getByLabel("Secret value", { exact: true })).toHaveCount(0);
});
