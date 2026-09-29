import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  if (await close.isVisible()) {
    await close.click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
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

test("template graphs stay centered when their cards resize", async ({ page }) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "Start from a template", exact: true }).first().click();
  const card = page
    .getByRole("heading", { name: "Announce a GitHub release", exact: true })
    .locator("../..");
  const preview = card.locator('[aria-hidden="true"] > svg').first();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(() =>
        preview.evaluate((svg) => {
          const frame = svg.getBoundingClientRect();
          const nodes = Array.from(svg.querySelectorAll("g > rect"), (node) =>
            node.getBoundingClientRect(),
          );
          const left = Math.min(...nodes.map((node) => node.left));
          const right = Math.max(...nodes.map((node) => node.right));
          const top = Math.min(...nodes.map((node) => node.top));
          const bottom = Math.max(...nodes.map((node) => node.bottom));
          return Math.max(
            Math.abs((left + right) / 2 - (frame.left + frame.right) / 2),
            Math.abs((top + bottom) / 2 - (frame.top + frame.bottom) / 2),
          );
        }),
      )
      .toBeLessThan(1);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/workflow-previews-${width}.png` });
  }
});

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
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: "Create draft Create draft", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Post text", { exact: true })).toBeVisible();
    const inspector = page.getByRole("dialog");
    await expect(inspector).toBeVisible();
    await page
      .locator('[data-workflow-field="workflow-text"]')
      .getByRole("button", { name: "Insert variable", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page
        .locator('[data-workflow-field="workflow-text"]')
        .getByRole("button", { name: "Insert variable", exact: true }),
    ).toBeFocused();
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
    const draftNode = page.getByRole("button", {
      name: "Create draft Create draft",
      exact: true,
    });
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
  await expect(page.locator('[data-workflow-field="workflow-data"] .workflow-token')).toHaveText(
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
  await page
    .locator('[data-workflow-field="workflow-fields"]')
    .getByRole("button", { name: "Insert variable", exact: true })
    .click();
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

test("typed variables render as chips in single-line fields", async ({ page }) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await addStep(page, "Create draft");
  await page.getByLabel("Title", { exact: true }).fill("Launch {{source.title}}");
  await expect(page.locator('[data-workflow-field="workflow-title"] .workflow-token')).toHaveText(
    "Source: title",
  );
  await page.getByLabel("Title", { exact: true }).fill("{{source.missing}}");
  await expect(page.getByLabel("Title", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.locator('[data-workflow-field="workflow-title"] .workflow-token-invalid'),
  ).toHaveText("source.missing");
});

test("numeric variables remain text in post fields", async ({ page }) => {
  const { token, workspace } = await openWorkflows(page);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page
    .getByLabel("Sample input (JSON)", { exact: true })
    .fill(JSON.stringify({ title: 42, body: "A result", url: "https://example.com" }));
  await addStep(page, "Create draft");
  await page.getByLabel("Post text", { exact: true }).fill("{{source.title}}");
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.getByText("Live", { exact: true }).click();
  await page.getByRole("button", { name: "Run live", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Completed$/ })).toBeVisible({
    timeout: 30000,
  });
  const publications = await page.request.get(`/api/v1/publications?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(publications.ok()).toBeTruthy();
  const posts = await publications.json();
  expect(posts).toHaveLength(1);
  expect(posts[0].source_text).toBe("42");
});

test("canvas context actions, organization, and recipes preserve an editable workflow", async ({
  page,
}) => {
  const { token, workspace } = await openWorkflows(page);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  const picker = page.getByRole("complementary", {
    name: "What happens next?",
  });
  await picker.getByRole("button", { name: "Recipes", exact: true }).click();
  await picker.getByRole("button", { name: /^Write a draft with AI/ }).click();
  await expect(page.getByLabel("System message", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Steps", exact: true })).toHaveCount(0);
  await expect(page.getByText("Usage is recorded", { exact: false })).toHaveCount(0);
  await page.getByLabel("Step name", { exact: true }).fill("Write announcement");
  await page.getByLabel("User message", { exact: true }).fill("Summarize {{source.body}}");
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  const writer = page.getByRole("button", {
    name: "Write announcement AI text",
    exact: true,
  });
  await writer.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(writer).toHaveCount(2);
  await writer.last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(writer).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(writer).toHaveCount(2);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(writer).toHaveCount(1);
  await writer.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const before = await writer.boundingBox();
  expect(before).toBeTruthy();
  await page.mouse.move(before!.x + 20, before!.y + 20);
  await page.mouse.down();
  await page.mouse.move(before!.x + 20, before!.y + 160, { steps: 10 });
  await page.mouse.up();
  const moved = await writer.boundingBox();
  expect(moved!.y).toBeGreaterThan(before!.y + 80);
  await page.getByRole("button", { name: "Organize", exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => Math.abs((await writer.boundingBox())!.y - before!.y))
    .toBeLessThan(2);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => Math.abs((await writer.boundingBox())!.y - moved!.y))
    .toBeLessThan(2);
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  const source = page.getByRole("button", {
    name: "Run manually Trigger",
    exact: true,
  });
  await expect
    .poll(async () => Math.abs((await writer.boundingBox())!.y - (await source.boundingBox())!.y))
    .toBeLessThan(2);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const id = page.url().split("/").at(-1);
  const response = await page.request.get(`/api/v1/workflows/${id}?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const { definition } = await response.json();
  expect(definition.steps.map((step: { kind: string }) => step.kind)).toEqual([
    "ai_text",
    "create_draft",
    "approval",
  ]);
  expect(definition.steps[1].inputs.text.reference).toBe(`${definition.steps[0].id}.text`);
  expect(definition.steps[2].inputs.publication_id.reference).toBe(`${definition.steps[1].id}.id`);
});

test("canvas shortcuts undo and redo without stealing text history", async ({ page }) => {
  await openWorkflows(page);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await addStep(page, "Create draft");
  const text = page.getByLabel("Post text", { exact: true });
  await text.fill("Original draft");
  await text.press("ControlOrMeta+z");
  await expect(text).toContainText("Source: title");
  await text.press("ControlOrMeta+Shift+z");
  await expect(text).toHaveText("Original draft");
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  const draft = page.getByRole("button", { name: "Create draft Create draft", exact: true });
  await draft.focus();
  await page.keyboard.press("ControlOrMeta+d");
  const nodes = page.getByRole("button", { name: "Create draft Create draft", exact: true });
  await expect(nodes).toHaveCount(2);
  await page.getByRole("button", { name: "Organize", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(nodes).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(nodes).toHaveCount(2);
  await page.keyboard.press("Meta+z");
  await expect(nodes).toHaveCount(1);
  await page.keyboard.press("Meta+Shift+z");
  await expect(nodes).toHaveCount(2);
  await nodes.first().focus();
  await page.keyboard.press("Delete");
  await expect(nodes).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(2);
});

for (const width of [1440, 390, 320]) {
  for (const scheme of ["light", "dark"] as const) {
    test(`workflow Social Sets reuse provider settings at ${width}px in ${scheme}`, async ({
      page,
    }) => {
      const { token, workspace } = await openWorkflows(page);
      const accountID = randomUUID();
      const db = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        db,
        `INSERT INTO social_accounts
        (id, workspace_id, slug, platform, account_id, account_username, access_token_encrypted, capability_state_json, is_active)
        VALUES ('${accountID}', '${workspace.id}', 'workflow-discord', 'discord', 'guild-test', 'Launch channel', X'00', '{"connection_type":"bot"}', 1);`,
      ]);
      await page.addInitScript((value) => localStorage.setItem("mode-watcher-mode", value), scheme);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await page.route(`**/api/v1/accounts/${accountID}/publishing-options/**`, (route) =>
        route.fulfill({ json: { options: [{ value: "updates-channel", label: "#updates" }] } }),
      );
      await page.getByRole("button", { name: "New workflow", exact: true }).click();
      if (width === 1440 && scheme === "light") {
        await page.route("**/api/v1/capabilities", (route) =>
          route.fulfill({ status: 503, json: { detail: "Destination settings unavailable" } }),
        );
      }
      await addStep(page, "Create draft");
      if (width === 1440 && scheme === "light") {
        await expect(page.getByRole("alert")).toContainText("Destination settings unavailable");
        await expect(page.getByTestId("composer-account-control")).toHaveCount(0);
        await page.unroute("**/api/v1/capabilities");
        await page.getByRole("button", { name: "Try again", exact: true }).click();
      }
      await page.getByTestId("composer-account-control").click();
      await page.getByRole("button", { name: "Manage Social Sets", exact: true }).click();
      const manager = page.getByRole("dialog", { name: "Manage Social Sets", exact: true });
      await manager
        .getByRole("textbox", { name: "Set name", exact: true })
        .fill("Launch destinations");
      await manager.getByLabel("Format for Launch channel", { exact: true }).click();
      await page.getByRole("option", { name: "Discord message", exact: true }).click();
      await manager.getByRole("button", { name: "Edit post settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Discord settings", exact: true });
      await settings.getByRole("combobox", { name: "Channel", exact: true }).click();
      await page.getByRole("option", { name: "#updates", exact: true }).click();
      await settings.getByRole("button", { name: "Done", exact: true }).click();
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/social-sets") && response.request().method() === "POST",
      );
      await manager.getByRole("button", { name: "Save", exact: true }).click();
      const response = await saved;
      expect(response.ok(), await response.text()).toBeTruthy();
      const set = await response.json();
      expect(set.accounts[0].default_settings).toEqual({ channel_id: "updates-channel" });
      await expect(manager.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await manager.getByRole("button", { name: "Save", exact: true }).focus();
      await page.keyboard.press("ControlOrMeta+z");
      await page.keyboard.press("Escape");
      await expect(manager).toBeHidden();
      await expect(page.getByTestId("composer-account-control")).toContainText(
        "Launch destinations",
      );
      await expect(
        page.getByText("Each run uses this set's current accounts and defaults.", { exact: false }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const nameFits = await page.getByLabel("Step name", { exact: true }).evaluate((element) => {
        if (!(element instanceof HTMLInputElement)) throw new Error("Step name must be an input");
        const style = getComputedStyle(element);
        const context = document.createElement("canvas").getContext("2d")!;
        context.font = style.font;
        const width =
          element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return context.measureText(element.value).width <= width;
      });
      expect(nameFits, "The node name should fit beside its header actions").toBe(true);
      await expect(
        page
          .getByRole("dialog", { name: "Create draft", exact: true })
          .getByText("Saved", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `test-results/workflow-destinations-${scheme}-${width}.png` });
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      const workflowURL = page.url();
      await page.reload();
      await page.getByRole("button", { name: "Create draft Create draft", exact: true }).click();
      await expect(page.getByTestId("composer-account-control")).toContainText(
        "Launch destinations",
      );
      if (width === 1440 && scheme === "light") {
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await page.getByRole("button", { name: "Test data", exact: true }).click();
        await page.getByText("Live", { exact: true }).click();
        await page.getByRole("button", { name: "Run live", exact: true }).click();
        await expect(page.getByRole("paragraph").filter({ hasText: /^Completed$/ })).toBeVisible({
          timeout: 30000,
        });
        const posts = await page.request.get(`/api/v1/publications?workspace_id=${workspace.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const publications = await posts.json();
        expect(publications).toHaveLength(1);
        const post = await page.request.get(`/api/v1/publications/${publications[0].id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const publication = await post.json();
        expect(publication.renditions[0].settings.channel_id).toBe("updates-channel");
        expect(publication.renditions[0].output_profile).toBe("discord.post");
        await page.goto(workflowURL);
        await page.getByRole("button", { name: "Create draft Create draft", exact: true }).click();
      }
      await page.getByTestId("composer-account-control").click();
      await page.getByTestId("composer-account-row").getByRole("checkbox").uncheck();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("composer-account-control")).not.toContainText(
        "Launch destinations",
      );
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await page.getByRole("button", { name: "Organize", exact: true }).focus();
      await page.keyboard.press("ControlOrMeta+z");
      await page.getByRole("button", { name: "Create draft Create draft", exact: true }).click();
      await expect(page.getByTestId("composer-account-control")).toContainText(
        "Launch destinations",
      );
    });
  }
}
