import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser, createPublication } from "./helpers";

test.describe("workflows", () => {
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
    await expect(page.locator("[data-workflow-inspector]")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(name);
  }
  async function releaseTemplate(page: import("@playwright/test").Page) {
    await page.getByRole("tab", { name: "Start from a template", exact: true }).click();
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
    await page.getByRole("tab", { name: "Start from a template", exact: true }).click();
    const card = page
      .getByRole("heading", { name: "Announce a GitHub release", exact: true })
      .locator("../..");
    const preview = card.locator('[aria-hidden="true"] > svg').first();
    for (const width of [1440, 320]) {
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
    const publications = await page.request.get(
      `/api/v1/publications?workspace_id=${workspace.id}`,
      {
        headers,
      },
    );
    expect(publications.ok()).toBeTruthy();
    expect(await publications.json()).toEqual([]);
    await page.getByRole("tab", { name: "Editor", exact: true }).click();
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
    await page.goto("/publications?tab=drafts");
    await expect(
      page
        .getByTestId("publication-list")
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
    test(`workflow templates and keyboard configuration at ${viewport.width}px`, async ({
      page,
    }) => {
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
    await expect(
      page.getByRole("button", { name: "Publish workflow", exact: true }),
    ).toBeDisabled();
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
        const control = (
          label === "Editor"
            ? page.getByRole("tab", { name: label, exact: true })
            : page.getByRole("button", { name: label, exact: true })
        ).first();
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
      await expect(zoom).toBeVisible();
      expect((await zoom.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await addStep(page, "Create draft");
      await page.getByRole("tab", { name: "Output", exact: true }).click();
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
    await output.getByRole("tab", { name: "Table", exact: true }).click();
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
        .getByRole("button", { name: /^Create draft / })
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

  test("picker handoff keeps the new step editable across layouts and keyboard input", async ({
    page,
  }, testInfo) => {
    await openWorkflows(page);
    for (const width of [1280, 320]) {
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto("/workflows");
        await page.getByRole("button", { name: "New workflow", exact: true }).click();
        const add = page.getByRole("button", { name: "Add step", exact: true });
        await add.focus();
        await add.press("Enter");
        const choice = page
          .getByRole("complementary", { name: "What happens next?" })
          .getByRole("button", { name: /^Create draft / });
        await choice.focus();
        await choice.press("Enter");
        await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
          "Create draft",
        );
        const text = page.getByLabel("Post text", { exact: true });
        const authored = `Audit picker ${width} ${scheme}`;
        await text.fill(authored);
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        const node = page.getByRole("button", { name: /^Create draft / });
        await node.focus();
        await node.press("Enter");
        await expect(text).toHaveText(authored);
        await page.screenshot({ path: testInfo.outputPath(`picker-${width}-${scheme}.png`) });
      }
    }
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
    await page.getByRole("button", { name: /^Announcement / }).click();
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
    const publications = await page.request.get(
      `/api/v1/publications?workspace_id=${workspace.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
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
    await picker.getByRole("tab", { name: "Recipes", exact: true }).click();
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
    const response = await page.request.get(
      `/api/v1/workflows/${id}?workspace_id=${workspace.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(response.ok()).toBeTruthy();
    const { definition } = await response.json();
    expect(definition.steps.map((step: { kind: string }) => step.kind)).toEqual([
      "ai_text",
      "create_draft",
      "approval",
    ]);
    expect(definition.steps[1].inputs.text.reference).toBe(`${definition.steps[0].id}.text`);
    expect(definition.steps[2].inputs.publication_id.reference).toBe(
      `${definition.steps[1].id}.id`,
    );
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

  for (const width of [1440, 320]) {
    for (const scheme of ["light"] as const) {
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
        await page.addInitScript(
          (value) => localStorage.setItem("mode-watcher-mode", value),
          scheme,
        );
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
            response.url().endsWith("/api/v1/social-sets") &&
            response.request().method() === "POST",
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
          page.getByText("Each run uses this set's current accounts and defaults.", {
            exact: false,
          }),
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
        await page.screenshot({
          path: `test-results/workflow-destinations-${scheme}-${width}.png`,
        });
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
          const posts = await page.request.get(
            `/api/v1/publications?workspace_id=${workspace.id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          const publications = await posts.json();
          expect(publications).toHaveLength(1);
          const post = await page.request.get(`/api/v1/publications/${publications[0].id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const publication = await post.json();
          expect(publication.renditions[0].settings.channel_id).toBe("updates-channel");
          expect(publication.renditions[0].output_profile).toBe("discord.post");
          await page.goto(workflowURL);
          await page
            .getByRole("button", { name: "Create draft Create draft", exact: true })
            .click();
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
});

test.describe("workflow approval links", () => {
  test("approval links select their workspace before loading a run, including same-route navigation", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    const auth = await registerUser(request, `approval-links-${randomUUID()}@example.com`);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const fixtures = [];
    for (const name of ["First approval", "Second approval"]) {
      const workspace = await createWorkspace(request, auth.token, name);
      const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
        headers,
        data: {
          name,
          description: "",
          expected_revision: 0,
          definition: {
            schema: 1,
            source: { kind: "manual" },
            steps: [
              {
                id: "fields",
                name: name + " marker",
                kind: "set_fields",
                inputs: { fields: { literal: { marker: name } } },
              },
            ],
          },
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const workflow = await created.json();
      const started = await request.post(
        `/api/v1/workflows/${workflow.id}/runs?workspace_id=${workspace.id}`,
        {
          headers,
          data: { expected_revision: workflow.revision, mode: "preview", source: {} },
        },
      );
      expect(started.ok(), await started.text()).toBeTruthy();
      const run = await started.json();
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(`/api/v1/workflow-runs/${run.id}?workspace_id=${workspace.id}`, {
                  headers,
                })
              ).json()
            ).state,
        )
        .toBe("succeeded");
      fixtures.push({
        workspace,
        run,
        href: `/workflows?run=${run.id}&workspace_id=${workspace.id}`,
      });
    }
    const [first, second] = fixtures;
    await authenticatePage(page, auth.token);
    await page.addInitScript((workspace) => {
      if (window !== window.top || sessionStorage.getItem("approval-link-fixture")) return;
      localStorage.setItem("openpost_current_workspace", JSON.stringify(workspace));
      sessionStorage.setItem("approval-link-fixture", "ready");
    }, second.workspace);
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/v1/workflow-runs/")) requests.push(req.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(first.href);
    await page.screenshot({ path: testInfo.outputPath("approval-entry.png") });
    await expect(page.getByText("Workflow revision 1 · Preview", { exact: true })).toBeVisible();
    await expect(
      page.locator("summary").filter({ hasText: "First approval marker" }),
    ).toBeVisible();
    await expect(page).toHaveURL(first.href);
    // A local link exercises SvelteKit navigation without remounting the app.
    async function followApprovalLink(href: string) {
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = "Open next approval";
        link.style.cssText =
          "position:fixed;top:80px;right:16px;z-index:1000;padding:12px;background:white;color:black";
        document.body.append(link);
      }, href);
      await page.getByRole("link", { name: "Open next approval" }).click();
      await page
        .getByRole("link", { name: "Open next approval" })
        .evaluate((link) => link.remove());
    }
    await followApprovalLink(second.href);
    await expect(
      page.locator("summary").filter({ hasText: "Second approval marker" }),
    ).toBeVisible();
    await expect(page).toHaveURL(second.href);
    for (const width of [1280, 320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`approval-${width}-${colorScheme}.png`),
        });
      }
    }
    expect(requests.some((url) => url.includes(first.run.id))).toBe(true);
    expect(requests.some((url) => url.includes(second.run.id))).toBe(true);
    for (const fixture of fixtures) {
      expect(
        requests
          .filter((url) => url.includes(fixture.run.id))
          .every((url) => new URL(url).searchParams.get("workspace_id") === fixture.workspace.id),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 844 });
    const workspaceButton = page
      .getByRole("button", { name: /First approval|Second approval/ })
      .first();
    await workspaceButton.click();
    await page.getByRole("menuitem", { name: /First approval/ }).click();
    await expect(workspaceButton).toContainText("First approval");
    await expect(page.locator("summary").filter({ hasText: "Second approval marker" })).toHaveCount(
      0,
    );
    await page.getByRole("tab", { name: "Runs", exact: true }).first().click();
    await expect(page.locator(`#workflow-run-${first.run.id}`)).toBeVisible();
    // Opening the same notification again must apply its destination again.
    await followApprovalLink(second.href);
    await expect(
      page.locator("summary").filter({ hasText: "Second approval marker" }),
    ).toBeVisible();
    await expect(workspaceButton).toContainText("Second approval");
    expect(errors).toEqual([]);
  });
});

test.describe("workflow builder destinations", () => {
  test("Builder destinations show required guidance and recover without execution", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(60000);
    const auth = await registerUser(request, `builder-dest-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Builder destinations");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','audit-${accountID}','bluesky','${accountID}','auditbuilder',X'00',1);`,
    ]);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit Builder destinations",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "build",
              kind: "build_draft",
              name: "Audit Builder",
              inputs: {
                text: { literal: "Synthetic internal post" },
                account_ids: { literal: [] },
                social_set_id: { literal: "" },
              },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const node = page.locator('.svelte-flow__node[data-id="build"]');
        await node.getByRole("button", { name: /^Audit Builder / }).click();
        const guidance = page.getByText("Choose a Social Set or destination first.", {
          exact: true,
        });
        if (width === 1280 && scheme === "light") await expect(guidance).toBeVisible();
        else {
          await page
            .getByRole("group", { name: "Destinations", exact: true })
            .getByRole("button", { name: /^Accounts:/ })
            .click();
          const account = page.getByRole("checkbox", { name: /auditbuilder/ });
          await account.uncheck();
          await page.keyboard.press("Escape");
          await expect(guidance).toBeVisible();
        }
        await page.screenshot({ path: info.outputPath(`destinations-${width}-${scheme}.png`) });
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(node).toContainText("Needs attention");
        await node.getByRole("button", { name: /^Audit Builder / }).click();
        const picker = page
          .getByRole("group", { name: "Destinations", exact: true })
          .getByRole("button", { name: /^Accounts:/ });
        await picker.focus();
        await picker.press("Enter");
        const account = page.getByRole("checkbox", { name: /auditbuilder/ });
        await account.focus();
        await account.press("Space");
        await page.keyboard.press("Escape");
        await expect(guidance).toBeHidden();
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(node).not.toContainText("Needs attention");
        await expect
          .poll(
            async () =>
              (
                await (
                  await request.get(
                    `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
                    {
                      headers,
                    },
                  )
                ).json()
              ).definition.steps[0].inputs.account_ids.literal,
          )
          .toEqual([accountID]);
        await page.reload();
      }
    const saved = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(saved.enabled).toBe(false);
    expect(saved.published_revision).toBe(0);
    expect(
      await (
        await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
      ).json(),
    ).toEqual([]);
  });
});

test.describe("workflow builder recovery", () => {
  const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const sql = (value: string) => `'${String(value).replaceAll("'", "''")}'`;

  test("failed native Builder output opens its authorized read-only build record", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(60000);
    const email = `builder-result-${randomUUID()}@example.com`;
    const auth = await registerUser(request, email);
    const workspace = await createWorkspace(request, auth.token, "Builder recovery");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const definition = {
      schema: 1,
      source: { kind: "manual" },
      steps: [
        {
          id: "build",
          name: "Audit failed build",
          kind: "build_draft",
          inputs: {
            text: { literal: "Synthetic internal post" },
            account_ids: { literal: ["synthetic-account"] },
          },
        },
      ],
    };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: { name: "Audit Builder recovery", description: "", expected_revision: 0, definition },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    const runID = randomUUID(),
      buildID = randomUUID();
    const message = "OpenPost could not build this post. You can retry it.";
    const output = {
      build_id: buildID,
      state: "failed",
      phase: "failed",
      error_code: "generation_failed",
      error_message: message,
    };
    const now = new Date().toISOString();
    const result = [
      {
        step_id: "build",
        name: "Audit failed build",
        kind: "build_draft",
        state: "failed",
        inputs: { text: "Synthetic internal post", account_ids: ["synthetic-account"] },
        output,
        error: message,
        started_at: now,
        completed_at: now,
      },
    ];
    // Immutable failure fixtures cross the normal authorized run and build read endpoints.
    // The separate Go regression produces this result through both actual durable jobs.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      databasePath,
      `
      INSERT INTO publication_builds (id, workspace_id, created_by_id, state, phase, idempotency_key, request_fingerprint, authority_json, request_json, error_code, error_message, created_at, updated_at)
      VALUES (${sql(buildID)},${sql(workspace.id)},(SELECT id FROM users WHERE email=${sql(email)}),'failed','failed',${sql(`workflow:${runID}:build`)},'synthetic','{}','{"input":{"idea":"Synthetic internal post","destinations":[]}}','generation_failed',${sql(message)},${sql(now)},${sql(now)});
      INSERT INTO workflow_runs (id,workflow_id,workspace_id,workflow_name,workflow_revision,mode,state,definition_json,authority_json,source_json,remaining_json,results_json,current_step_id,error,created_at,updated_at)
      VALUES (${sql(runID)},${sql(workflow.id)},${sql(workspace.id)},${sql(workflow.name)},${workflow.revision},'live','failed',${sql(JSON.stringify(definition))},'{}','{}','[]',${sql(JSON.stringify(result))},'build',${sql(message)},${sql(now)},${sql(now)});
    `,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await page
          .locator("[data-workflow-editor] > header")
          .getByRole("tab", { name: "Runs", exact: true })
          .click();
        await page.locator("aside button").filter({ hasText: "Failed" }).click();
        await page.getByRole("button", { name: /^Audit failed build / }).click();
        if (width < 1024) await page.getByRole("tab", { name: "Output", exact: true }).click();
        const inspect = page.getByRole("button", { name: "Inspect build", exact: true });
        await expect(inspect).toBeVisible();
        await inspect.focus();
        await inspect.press("Enter");
        const details = page.getByRole("dialog", { name: "Build details", exact: true });
        await expect(details).toContainText(buildID);
        await expect(details).toContainText("generation_failed");
        await expect(details).toContainText(message);
        await page.screenshot({ path: info.outputPath(`build-${width}-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(details).toBeHidden();
        await expect(inspect).toBeFocused();
      }
    expect(
      (
        await (
          await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
            headers,
          })
        ).json()
      ).enabled,
    ).toBe(false);
  });
});

test.describe("workflow comment campaign", () => {
  function seedComment(workspaceID: string, publicationID: string) {
    const accountID = randomUUID(),
      renditionID = randomUUID(),
      itemID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `
      PRAGMA foreign_keys=ON;
  UPDATE publications SET status='published' WHERE id='${publicationID}';
      INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active,granted_scopes) VALUES('${accountID}','${workspaceID}','${accountID}','instagram','sample-owner','Sample studio',X'00',1,'instagram_manage_comments,pages_read_engagement');
      INSERT INTO account_features(social_account_id,workspace_id,feature,enabled,decided_at) VALUES('${accountID}','${workspaceID}','engagement',1,CURRENT_TIMESTAMP);
      INSERT INTO renditions(id,publication_id,social_account_id,target_key,platform,profile,status,external_id) VALUES('${renditionID}','${publicationID}','${accountID}','instagram','instagram','reel','published','sample-reel');
      INSERT INTO engagement_items(id,workspace_id,rendition_id,social_account_id,platform,remote_id,conversation_remote_id,author_remote_id,author_name,body,can_reply,last_seen_at,remote_created_at) VALUES('${itemID}','${workspaceID}','${renditionID}','${accountID}','instagram','${itemID}','sample-reel','sample-reader','Sample reader','GRIND please!',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    `,
    ]);
    return { accountID, renditionID, itemID };
  }

  test("a Reel campaign starts with focused setup, previews safely and saves separate private/public steps", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120000);
    const auth = await registerUser(request, `comment-campaign-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Comment campaigns");
    const publication = await createPublication(
      request,
      auth.token,
      workspace.id,
      "Sample playbook Reel",
    );
    const { accountID, renditionID } = seedComment(workspace.id, publication.id);
    const errors: string[] = [],
      dispatches: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/(publish|run|test-node|actions)(?:\?|$)/.test(req.url()))
        dispatches.push(req.url());
    });
    await authenticatePage(page, auth.token);
    await page.goto(
      `/workflows?template=instagram-playbook&account_id=${accountID}&rendition_id=${renditionID}`,
    );
    const setup = page.getByRole("region", { name: "Set up comment replies" });
    await expect(setup).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".svelte-flow")).toHaveCount(0);
    await expect(page.getByLabel("Keywords or phrases", { exact: true })).toHaveValue("GRIND");
    const create = page.getByRole("button", { name: "Create workflow draft", exact: true });
    await expect(create).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("comment-campaign-before.png"),
      fullPage: true,
    });
    await page.getByLabel("Saved response", { exact: true }).fill("🔥".repeat(251));
    await expect(create).toBeDisabled();
    await expect(setup.getByRole("alert")).toContainText("1,000 UTF-8 bytes");
    await page
      .getByLabel("Saved response", { exact: true })
      .fill("Here is the full playbook: https://example.com/playbook");
    await expect(create).toBeEnabled();
    await page.getByRole("button", { name: "Preview", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(setup.locator("blockquote")).toContainText("GRIND please!");
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", scheme);
        await expect(page.locator("body")).toHaveJSProperty(
          "scrollWidth",
          await page.locator("body").evaluate((el) => el.clientWidth),
        );
        await setup.locator("h2").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`comment-campaign-${width}-${scheme}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && /\/api\/v1\/workflows\?/.test(response.url()),
    );
    await create.click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    expect(workflow.enabled).toBe(false);
    expect(workflow.definition.source).toMatchObject({
      kind: "comment_received",
      account_ids: [accountID],
      rendition_ids: [renditionID],
      keywords: ["GRIND"],
      post_scope: "selected",
    });
    expect(workflow.definition.steps.map((step: { kind: string }) => step.kind)).toEqual([
      "private_comment_reply",
      "comment_reply",
    ]);
    expect(workflow.definition.steps[0].inputs.text.literal).toBe(
      "Here is the full playbook: https://example.com/playbook",
    );
    expect(workflow.definition.steps[1].inputs.text.literal).toBe("Sent! Check your messages.");
    expect(dispatches).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("Inbox review keeps the edited private reply and takeover cancels the waiting run", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `comment-review-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Reply review");
    const publication = await createPublication(request, auth.token, workspace.id, "Review Reel");
    const { itemID } = seedComment(workspace.id, publication.id);
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Review private playbook",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "reply",
              name: "Send private playbook",
              kind: "private_comment_reply",
              inputs: {
                engagement_id: { literal: itemID },
                text: { literal: "Original playbook message" },
                delivery: { literal: "review" },
              },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    // The browser server has no Meta app configured. Seed a stored proposal;
    // native admission and delivery are exercised with provider adapters in Go.
    const run = { id: randomUUID() };
    const replyID = randomUUID();
    const sql = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const inputs = { engagement_id: itemID, text: "Original playbook message", delivery: "review" };
    const results = [
      {
        step_id: "reply",
        kind: "private_comment_reply",
        name: "Send private playbook",
        state: "awaiting_approval",
        inputs,
        output: {
          engagement_id: itemID,
          status: "awaiting_review",
          text: inputs.text,
          channel: "private",
        },
      },
    ];
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `
      PRAGMA foreign_keys=ON;
      INSERT INTO workflow_runs(id,workflow_id,workspace_id,workflow_name,workflow_revision,revision,mode,state,definition_json,authority_json,source_json,remaining_json,results_json,current_step_id,created_at,updated_at)
      VALUES('${run.id}','${workflow.id}','${workspace.id}','Review private playbook',1,1,'live','awaiting_approval',${sql(JSON.stringify(workflow.definition))},'{}',${sql(JSON.stringify({ engagement_id: itemID }))},${sql(JSON.stringify(workflow.definition.steps))},${sql(JSON.stringify(results))},'reply',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO engagement_automation_replies(id,workspace_id,item_id,workflow_id,run_id,step_id,user_id,channel,body,item_body,state,created_at,updated_at)
      VALUES('${replyID}','${workspace.id}','${itemID}','${workflow.id}','${run.id}','reply',(SELECT created_by FROM publications WHERE id='${publication.id}'),'private','Original playbook message','GRIND please!','awaiting_review',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    `,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto("/inbox/engagement");
    await page.locator("summary").filter({ hasText: "Reply waiting for review" }).click();
    const textarea = page.getByLabel("Saved response", { exact: true });
    await expect(textarea).toHaveValue("Original playbook message");
    await textarea.fill("Edited playbook message");
    let approvalBody: unknown;
    await page.route(`**/api/v1/workflow-runs/${run.id}/approve?**`, async (route) => {
      approvalBody = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        json: { detail: "This review changed. Refresh and try again." },
      });
    });
    await page.getByRole("button", { name: "Approve reply", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("This review changed");
    expect(approvalBody).toMatchObject({ reply_text: "Edited playbook message" });
    await expect(textarea).toHaveValue("Edited playbook message");
    await page.setViewportSize({ width: 390, height: 1000 });
    await textarea.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("comment-review-phone.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Take over", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/v1/workflow-runs/${run.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).state,
      )
      .toBe("cancelled");
    await expect(
      page.locator("summary").filter({ hasText: "Automatic replies stopped" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("comment-takeover-phone.png"),
      fullPage: true,
    });
  });
});

test.describe("workflow condition validation", () => {
  test("Condition test explains the visible field and preserves older output as history", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const auth = await registerUser(request, `condition-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Condition correction");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit condition correction",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "condition",
              name: "Audit condition",
              kind: "condition",
              inputs: {
                left: { literal: "release" },
                operator: { literal: "contains" },
                right: { literal: "release" },
              },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    const errors: string[] = [];
    let testsAdmitted = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/test-node")) testsAdmitted++;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit condition / }).click();
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    await expect(output.getByText("Completed", { exact: true })).toBeVisible();
    await expect(output.getByText("matched", { exact: true })).toBeVisible();
    await expect(output.getByText("true", { exact: true })).toBeVisible();
    for (const width of [1280, 390, 320]) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const configure = page.getByRole("tab", { name: "Configure", exact: true });
        if (width < 1024) await configure.click();
        await page.getByLabel("Compare with", { exact: true }).fill("");
        const admission = page.getByRole("button", { name: "Test node", exact: true });
        const before = testsAdmitted;
        await admission.focus();
        await admission.press("Enter");
        await expect(page.locator("#workflow-inspector-error")).toContainText(
          "Compare with: This field is required.",
        );
        await expect(page.getByLabel("Compare with", { exact: true })).toBeFocused();
        expect(testsAdmitted).toBe(before);
        await page.screenshot({
          path: testInfo.outputPath(`condition-invalid-${width}-${scheme}.png`),
        });
        if (width < 1024) await page.getByRole("tab", { name: "Output", exact: true }).click();
        await expect(output).toContainText("Configuration or test data changed since this result.");
        await expect(output.getByText("Completed", { exact: true })).toBeVisible();
        if (width < 1024) await configure.click();
        await page.getByLabel("Compare with", { exact: true }).fill("release");
        await admission.click();
        await expect(page.locator("#workflow-inspector-error")).toBeHidden();
        await expect(output).not.toContainText(
          "Configuration or test data changed since this result.",
        );
        await expect(output.getByText("true", { exact: true })).toBeVisible();
      }
    }
    expect(testsAdmitted).toBe(7);
    await expect
      .poll(async () => {
        const response = await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, {
          headers,
        });
        expect(response.ok(), await response.text()).toBe(true);
        const runs = await response.json();
        return runs
          .filter((run: { workflow_id: string }) => run.workflow_id === workflow.id)
          .map((run: { state: string }) => run.state);
      })
      .toEqual(Array(7).fill("succeeded"));
    const persisted = await request.get(
      `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(persisted.ok()).toBe(true);
    const saved = await persisted.json();
    expect(saved.enabled).toBe(false);
    expect(saved.published_revision).toBe(0);
    expect(saved.definition.steps[0].inputs.right).toEqual({ literal: "release" });
    expect(errors).toEqual([]);
  });
});

test.describe("workflow destinations loading", () => {
  test("saved destinations finish loading when Social Sets settle before capabilities", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `destinations-loading-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Destination read order");
    const accountID = randomUUID();
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','audit-${accountID}','bluesky','${accountID}','auditbuilder',X'00',1);`,
    ]);
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Audit destinations read order",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "build",
              kind: "build_draft",
              name: "Audit Builder",
              inputs: {
                text: { literal: "Synthetic internal post" },
                account_ids: { literal: [accountID] },
              },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    await authenticatePage(page, auth.token);
    const setsResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/social-sets",
    );
    await page.route("**/api/v1/capabilities", async (route) => {
      const response = await route.fetch();
      const sets = await setsResponse;
      expect(sets.ok()).toBe(true);
      expect(response.ok()).toBe(true);
      await sets.finished();
      // Deliver the actual capability response after the faster read has rendered.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await route.fulfill({ response });
    });
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit Builder / }).click();
    const destinations = page.getByRole("group", { name: "Destinations", exact: true });
    await expect(destinations.getByRole("button", { name: /^Accounts:/ })).toBeVisible();
    await expect(destinations.getByRole("status")).toBeHidden();
    await destinations.getByRole("button", { name: /^Accounts:/ }).click();
    await expect(page.getByRole("checkbox", { name: /auditbuilder/ })).toBeChecked();
    await page.keyboard.press("Escape");
  });
});

test.describe("workflow filter null guidance", () => {
  test("Filter distinguishes present null from absent and allows correction", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-null-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Filter null guidance");
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Audit filter null guidance",
        expected_revision: 0,
        description: "",
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "filter",
              name: "Audit filter",
              kind: "list_filter",
              inputs: {
                items: { literal: [{ id: "present", value: null }] },
                field: { literal: "value" },
                operator: { literal: "equals" },
                right: { literal: 2 },
              },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const workflow = await response.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit filter / }).click();
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    const nullError = output.getByText("field item.value is null; provide a non-null value", {
      exact: true,
    });
    await expect(nullError).toBeVisible();
    for (const width of [320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
        await expect(nullError).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`filter-null-${width}-${colorScheme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const items = page.getByRole("textbox", { name: "Items", exact: true });
    await items.fill('[{"id":"absent"}]');
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await expect(output.getByText("field item.value is missing", { exact: true })).toBeVisible();
    await items.fill('[{"id":"recovered","value":2}]');
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await expect(output.getByText("recovered", { exact: true })).toBeVisible();
    await output.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual({ count: 1, items: [{ id: "recovered", value: 2 }] });
    await page.screenshot({ path: testInfo.outputPath("filter-numeric-recovery.png") });
    expect(errors).toEqual([]);
  });
});

test.describe("workflow graph admission", () => {
  for (const concern of ["loop", "ports"] as const) {
    test(`workflow graph ${concern} preserves authored connections`, async ({
      page,
      request,
    }, testInfo) => {
      test.setTimeout(60000);
      const auth = await registerUser(request, `graph-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Graph admission");
      const headers = { Authorization: `Bearer ${auth.token}` };
      const definition = {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "condition",
            name: "Audit condition",
            kind: "condition",
            inputs: {
              left: { literal: "release" },
              operator: { literal: "contains" },
              right: { literal: "release" },
            },
            then: [
              {
                id: "yes",
                name: "Audit yes",
                kind: "parse_json",
                inputs: { text: { literal: "{}" } },
              },
            ],
            else: [
              {
                id: "no",
                name: "Audit no",
                kind: "parse_json",
                inputs: { text: { literal: "{}" } },
              },
            ],
          },
        ],
      };
      const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
        headers,
        data: { name: "Audit graph admission", description: "", expected_revision: 0, definition },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const workflow = await created.json();
      const path = `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await authenticatePage(page, auth.token);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/workflows/${workflow.id}`);
      await expect(page.getByRole("button", { name: /^Audit condition / })).toBeVisible();
      await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
      async function drag(source: string, target: string) {
        await expect
          .poll(() =>
            page.locator(".svelte-flow__viewport").evaluate(async (element) => {
              const before = element.style.transform;
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              return before === element.style.transform;
            }),
          )
          .toBe(true);
        for (const handle of [
          page.locator(`.svelte-flow__handle.source[data-nodeid="${source}"]`),
          page.locator(`.svelte-flow__handle.target[data-nodeid="${target}"]`),
        ]) {
          await expect
            .poll(() =>
              handle.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return (
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) ===
                  element
                );
              }),
            )
            .toBe(true);
        }
        await page
          .locator(`.svelte-flow__handle.source[data-nodeid="${source}"]`)
          .dragTo(page.locator(`.svelte-flow__handle.target[data-nodeid="${target}"]`));
      }
      if (concern === "ports") {
        for (const width of [1280, 320]) {
          for (const scheme of ["light"] as const) {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
            await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
            for (const name of [
              "Audit condition: input",
              "Audit condition: Yes output",
              "Audit condition: No output",
              "Audit yes: output",
              "Run manually: output",
            ])
              await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Handle", exact: true })).toHaveCount(0);
            const node = page.getByRole("button", { name: /^Audit condition / });
            await node.focus();
            await page.keyboard.press("Enter");
            await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
              "Audit condition",
            );
            await page.getByRole("button", { name: "Back to canvas", exact: true }).focus();
            await page.keyboard.press("Enter");
            await expect(node).toBeFocused();
            await page.screenshot({ path: testInfo.outputPath(`ports-${width}-${scheme}.png`) });
          }
        }
      } else {
        await drag("yes", "condition");
        await expect(
          page.getByText(
            "This connection would create a loop. Connect to a step outside this branch.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("img", { name: "Edge from yes to condition", exact: true }),
        ).toHaveCount(0);
        expect((await (await request.get(path, { headers })).json()).definition).toEqual(
          definition,
        );
        for (const width of [1280, 320]) {
          for (const scheme of ["light"] as const) {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
            await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
            await page.screenshot({ path: testInfo.outputPath(`warning-${width}-${scheme}.png`) });
            const warning = page
              .getByRole("status")
              .filter({ hasText: "This connection would create a loop." });
            await expect(warning).toBeVisible();
            await warning.getByRole("button", { name: "Close", exact: true }).focus();
            await page.keyboard.press("Enter");
            await expect(warning).toHaveCount(0);
            await drag("yes", "condition");
            await expect(warning).toBeVisible();
            await expect(page.getByRole("img", { name: /^Edge from/ })).toHaveCount(3);
          }
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
        await drag("yes", "no");
        const { else: noSteps, ...condition } = definition.steps[0];
        const reparented = {
          ...definition,
          steps: [{ ...condition, then: [...condition.then, ...noSteps] }],
        };
        await expect
          .poll(async () => (await (await request.get(path, { headers })).json()).definition)
          .toEqual(reparented);
        await expect(
          page.getByText("This connection would create a loop.", { exact: false }),
        ).toHaveCount(0);
        await page.getByRole("button", { name: "Undo", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect
          .poll(async () => (await (await request.get(path, { headers })).json()).definition)
          .toEqual(definition);
        await page.reload();
        await expect(page.getByRole("button", { name: /^Audit condition / })).toBeVisible();
        await expect(
          page.getByRole("img", { name: "Edge from condition to no", exact: true }),
        ).toHaveCount(1);
        expect((await (await request.get(path, { headers })).json()).definition).toEqual(
          definition,
        );
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("workflow http guidance", () => {
  const guidance =
    "Preview does not send the request. Test node and Live runs send the configured request once and stop for inspection if delivery is uncertain.";

  test("HTTP node explains the real test request before keyboard execution", async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `http-guidance-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "HTTP guidance");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit local HTTP guidance",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "http",
              name: "Audit local HTTP",
              kind: "http_request",
              inputs: {
                method: { literal: "GET" },
                url: { literal: "http://127.0.0.1:9/audit-http" },
                headers: { literal: {} },
                query: { literal: {} },
                timeout: { literal: 20 },
                response_format: { literal: "auto" },
              },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const node = page.getByRole("button", { name: /^Audit local HTTP / });
        await node.focus();
        await node.press("Enter");
        await expect(page.getByText(guidance, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Test node", exact: true })).toBeEnabled();
        await page.screenshot({ path: info.outputPath(`http-${width}-${scheme}.png`) });
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      }
    await page.getByRole("button", { name: "Run preview", exact: true }).click();
    await expect
      .poll(async () => {
        const runs = await (
          await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
        ).json();
        return runs.find((run: { mode: string }) => run.mode === "preview")?.state;
      })
      .toBe("succeeded");
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit local HTTP / }).click();
    const runTest = page.getByRole("button", { name: "Test node", exact: true });
    await runTest.focus();
    await runTest.press("Enter");
    await expect
      .poll(async () => {
        const runs = await (
          await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
        ).json();
        return runs.find((run: { mode: string }) => run.mode === "test")?.state;
      })
      .toBe("failed");
    const runs = await (
      await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
    ).json();
    const preview = runs.find((run: { mode: string }) => run.mode === "preview");
    const previewDetail = await (
      await request.get(`/api/v1/workflow-runs/${preview.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(previewDetail.steps[0].output.preview).toBe(true);
    const tested = runs.find((run: { mode: string }) => run.mode === "test");
    const detail = await (
      await request.get(`/api/v1/workflow-runs/${tested.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(detail.error).toMatch(/private|public|loopback|blocked/i);
    const saved = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(saved.enabled).toBe(false);
    expect(runs).toHaveLength(2);
  });
});

test.describe("workflow http json inspection", () => {
  const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const message =
    "response is not valid JSON (HTTP 502); choose Text or Auto detect for a text response, or correct the remote JSON response";

  test("failed HTTP JSON output exposes safe metadata instead of an empty-output instruction", async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `json-inspection-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "HTTP JSON inspection");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const definition = {
      schema: 1,
      source: { kind: "manual" },
      steps: [
        {
          id: "request",
          name: "Audit JSON diagnosis",
          kind: "http_request",
          inputs: {
            method: { literal: "GET" },
            url: { literal: "https://example.com/audit" },
            response_format: { literal: "json" },
          },
        },
      ],
    };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit JSON failure inspection",
        description: "",
        expected_revision: 0,
        definition,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    const runID = randomUUID(),
      now = new Date().toISOString();
    const result = [
      {
        step_id: "request",
        name: "Audit JSON diagnosis",
        kind: "http_request",
        state: "failed",
        inputs: { method: "GET", url: "https://example.com/audit", response_format: "json" },
        output: { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
        error: message,
        started_at: now,
        completed_at: now,
      },
    ];
    // Presentation-only terminal snapshot. The separate durable Go test produces
    // this response diagnosis through the owning injected HTTP transport.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
      `INSERT INTO workflow_runs (id,workflow_id,workspace_id,workflow_name,workflow_revision,mode,state,definition_json,authority_json,source_json,remaining_json,results_json,current_step_id,error,created_at,updated_at) VALUES (${sql(runID)},${sql(workflow.id)},${sql(workspace.id)},${sql(workflow.name)},${workflow.revision},'test','failed',${sql(JSON.stringify(definition))},'{}','{}','[]',${sql(JSON.stringify(result))},'request',${sql(message)},${sql(now)},${sql(now)});`,
    ]);
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await page
          .locator("[data-workflow-editor] > header")
          .getByRole("tab", { name: "Runs", exact: true })
          .click();
        await page.locator("aside button").filter({ hasText: "Failed" }).click();
        const node = page.getByRole("button", { name: /^Audit JSON diagnosis / });
        await node.focus();
        await node.press("Enter");
        if (width < 1024) await page.getByRole("tab", { name: "Output", exact: true }).click();
        const output = page.getByRole("region", { name: "Output", exact: true });
        await expect(output).toContainText(message);
        await expect(output.getByText("502", { exact: true })).toBeVisible();
        await expect(output.getByText("text/html; charset=utf-8", { exact: true })).toBeVisible();
        await expect(output).not.toContainText("Run or test this node to see its output.");
        await page.screenshot({ path: info.outputPath(`json-${width}-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(node).toBeFocused();
      }
    const runs = await (
      await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
    ).json();
    expect(runs).toHaveLength(1);
    expect(runs[0].state).toBe("failed");
    expect(
      (
        await (
          await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
            headers,
          })
        ).json()
      ).enabled,
    ).toBe(false);
  });
});

test.describe("workflow inspector focus", () => {
  test("opening a workflow inspector preserves the field a user has already focused", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workflow-focus-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Inspector focus");
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Inspector focus audit",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "parse",
              name: "Audit parse",
              kind: "parse_json",
              inputs: { text: { literal: "{}" } },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    await authenticatePage(page, auth.token);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/workflows/${workflow.id}`);
    const node = page.getByRole("button", { name: /^Audit parse / });
    await expect(node).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await node.click();
    const field = page.getByRole("textbox", { name: "Text", exact: true });
    await field.fill('{"value":2}');
    await expect(field).toBeFocused();
    // A fast user can reach a field before the dialog's first animation frame.
    await page.clock.runFor(32);
    await expect(field).toBeFocused();
    await page.keyboard.type(" ");
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Audit parse",
    );
    await expect(field).toHaveText('{"value":2} ');
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect(node).toBeFocused();
    await page.clock.resume();
  });
});

test.describe("workflow json preview", () => {
  test("Edit fields preview preserves escaping and whole-value types through execution", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-json-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "JSON preview");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const phrase = 'He said "Café"\\folder\n東京 👋';
    const source = { phrase, object: { text: phrase, values: [1, false, null] } };
    const authored = '{"copied":"{{source.phrase}}","nested":["prefix {{source.phrase}} suffix"]}';
    const expected = { copied: phrase, nested: [`prefix ${phrase} suffix`] };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit JSON preview",
        expected_revision: 0,
        description: "",
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "fields",
              name: "Audit fields",
              kind: "set_fields",
              inputs: { fields: { literal: authored } },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const workflow = await response.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: "Test data", exact: true }).click();
    await page.locator("#workflow-sample-json").fill(JSON.stringify(source));
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: /^Audit fields / }).click();
    const field = page.locator('[data-workflow-field="workflow-fields"]');
    const preview = field.locator("pre");
    await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(expected);
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    await output.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual(expected);
    for (const width of [320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
        await page.getByRole("tab", { name: "Configure", exact: true }).click();
        await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(expected);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`json-preview-${width}-${colorScheme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const editor = field.getByRole("textbox");
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await editor.pressSequentially('{"copied":');
    await expect(field.getByRole("status")).toHaveText("Enter valid JSON.");
    await expect(preview).toHaveCount(0);
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await field.getByRole("button", { name: "Insert variable", exact: true }).click();
    await page.getByRole("combobox", { name: /^Search variables/ }).fill("source.object");
    await page.getByRole("combobox", { name: /^Search variables/ }).press("Enter");
    await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(source.object);
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
            headers,
          })
        ).json();
        return saved.definition.steps[0].inputs.fields;
      })
      .toEqual({ reference: "source.object" });
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual(source.object);
    await page.reload();
    await page.getByRole("button", { name: /^Audit fields / }).click();
    await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "source.object");
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: "Test data", exact: true }).click();
    await page.locator("#workflow-sample-json").fill(JSON.stringify(source));
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: /^Audit fields / }).click();
    await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(source.object);
    expect(errors).toEqual([]);
  });
});

test.describe("workflow layout", () => {
  test("pointer and keyboard canvas positions survive actual reload without revising the workflow", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-layout-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Canvas placement");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const definition = {
      schema: 1,
      source: { kind: "manual" },
      steps: [
        {
          id: "parse",
          name: "Audit placement",
          kind: "parse_json",
          inputs: { text: { literal: "{}" } },
        },
      ],
    };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: { name: "Audit canvas placement", description: "", expected_revision: 0, definition },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const workflow = await created.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    const node = page.locator('.svelte-flow__node[data-id="parse"]');
    await expect(node).toBeVisible();
    const position = () =>
      node.evaluate((element) => {
        const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: transform.m41, y: transform.m42 };
      });
    const baseline = await position();
    const bounds = await node.boundingBox();
    expect(bounds).not.toBeNull();
    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + bounds!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(position).not.toEqual(baseline);
    const pointerPosition = await position();
    await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(position).toEqual(pointerPosition);
    for (
      let count = 0;
      count < 90 && !(await node.evaluate((element) => document.activeElement === element));
      count++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(node).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    const keyboardPosition = { x: pointerPosition.x, y: pointerPosition.y + 5 };
    await expect.poll(position).toEqual(keyboardPosition);
    await page.reload();
    await expect.poll(position).toEqual(keyboardPosition);
    for (const width of [1280, 390]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme });
        await page.reload();
        await expect.poll(position).toEqual(keyboardPosition);
        await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`canvas-cold-reload-${width}-${colorScheme}.png`),
        });
      }
    }
    const saved = await request.get(
      `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
      {
        headers,
      },
    );
    expect(saved.ok()).toBeTruthy();
    const retained = await saved.json();
    expect(retained.revision).toBe(workflow.revision);
    expect(retained.definition).toEqual(workflow.definition);
    expect(retained.enabled).toBe(false);
    const runs = await request.get(
      `/api/v1/workflow-runs?workspace_id=${workspace.id}&workflow_id=${workflow.id}`,
      { headers },
    );
    expect(runs.ok()).toBeTruthy();
    expect(await runs.json()).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("workflow literal key picker", () => {
  test("literal dotted keys and nested paths remain distinct picker references", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-keys-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Literal key references");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit literal keys",
        expected_revision: 0,
        description: "",
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "text",
              name: "Audit text",
              kind: "text",
              inputs: { text: { literal: "" }, operation: { literal: "trim" } },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const workflow = await response.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: "Test data", exact: true }).click();
    await page
      .locator("#workflow-sample-json")
      .fill(JSON.stringify({ "a.b": "DOT", a: { b: "NEST" } }));
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: /^Audit text / }).click();
    const field = page.locator('[data-workflow-field="workflow-text"]');
    await field.getByRole("button", { name: "Insert variable", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /^Search variables/ })).toBeVisible();
    expect(errors).toEqual([]);
    await expect(page.getByRole("option").filter({ hasText: 'source["a.b"]' })).toBeVisible();
    await expect(page.getByRole("option").filter({ hasText: "source.a.b" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(field.getByRole("button", { name: "Insert variable", exact: true })).toBeFocused();
    const input = page.getByRole("region", { name: "Input", exact: true });
    await expect(input.getByText('source["a.b"]', { exact: true })).toBeVisible();
    await expect(input.getByText("source.a.b", { exact: true })).toBeVisible();
    for (const [reference, expected] of [
      ['source["a.b"]', "DOT"],
      ["source.a.b", "NEST"],
    ]) {
      await field.getByRole("textbox").click();
      await field.getByRole("textbox").press("ControlOrMeta+A");
      await field.getByRole("textbox").press("Backspace");
      await field.getByRole("button", { name: "Insert variable", exact: true }).click();
      const search = page.getByRole("combobox", { name: /^Search variables/ });
      await search.fill(reference);
      if (expected === "DOT") await search.press("Enter");
      else await page.getByRole("option").filter({ hasText: reference }).click();
      await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", reference);
      await expect(field.getByText(expected, { exact: true })).toBeVisible();
      await expect
        .poll(async () => {
          const saved = await (
            await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json();
          return saved.definition.steps[0].inputs.text.literal;
        })
        .toBe(`{{${reference}}}`);
      await page.getByRole("button", { name: "Test node", exact: true }).click();
      const output = page.getByRole("region", { name: "Output", exact: true });
      await expect(output.getByText(expected, { exact: true })).toBeVisible({ timeout: 30000 });
    }
    expect(errors).toEqual([]);
    for (const width of [320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.getByRole("tab", { name: "Configure", exact: true }).click();
        await field.getByRole("button", { name: "Insert variable", exact: true }).click();
        await expect(page.getByRole("option").filter({ hasText: 'source["a.b"]' })).toBeVisible();
        await expect(page.getByRole("option").filter({ hasText: "source.a.b" })).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`distinct-reference-picker-${width}-${colorScheme}.png`),
        });
        await page.keyboard.press("Escape");
        await expect(
          field.getByRole("button", { name: "Insert variable", exact: true }),
        ).toBeFocused();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
      }
    }
    expect(errors).toEqual([]);
  });
});

test.describe("workflow new step viewport", () => {
  test("appending a workflow step keeps its next action inside the canvas", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const auth = await registerUser(request, `canvas-append-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Canvas append");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit append viewport",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: ["first", "second"].map((id) => ({
            id,
            name: `Audit ${id}`,
            kind: "parse_json",
            inputs: { text: { literal: "{}" } },
          })),
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    await authenticatePage(page, auth.token);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/workflows/${workflow.id}`);
    await page
      .locator('.svelte-flow__node[data-id="second"]')
      .getByRole("button", { name: "Add after this step", exact: true })
      .click();
    await page
      .getByRole("complementary", { name: "What happens next?" })
      .getByRole("button", { name: /^Transform text / })
      .click();
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Transform text",
    );
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    const node = page
      .locator(".svelte-flow__node")
      .filter({ has: page.getByRole("button", { name: /^Transform text / }) });
    const next = node.getByRole("button", { name: "Add after this step", exact: true });
    await expect(page.locator("[data-workflow-inspector]")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("appended-step.png") });
    await expect
      .poll(() =>
        next.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const canvas = element.closest(".workflow-canvas")!.getBoundingClientRect();
          return (
            bounds.left >= canvas.left &&
            bounds.right <= canvas.right &&
            bounds.top >= canvas.top &&
            bounds.bottom <= canvas.bottom &&
            element.contains(
              document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
            )
          );
        }),
      )
      .toBe(true);
    await next.click();
    await expect(page.getByRole("complementary", { name: "What happens next?" })).toBeVisible();
    await page
      .getByRole("complementary", { name: "What happens next?" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    for (const width of [1280, 390, 320]) {
      for (const scheme of ["light", "dark"] as const) {
        await expect
          .poll(
            async () =>
              (
                await (
                  await request.get(
                    `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
                    {
                      headers,
                    },
                  )
                ).json()
              ).definition.steps.length,
          )
          .toBeGreaterThanOrEqual(3);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await expect(page.getByRole("button", { name: "Add step", exact: true })).toBeVisible();
        const scale = () =>
          page
            .locator(".svelte-flow__viewport")
            .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
        if (width < 640 && scheme === "light") {
          for (let i = 0; i < 3; i++) {
            const beforeClick = await scale();
            await page.getByRole("button", { name: "Zoom in", exact: true }).click();
            await expect.poll(scale).toBeGreaterThan(beforeClick);
          }
        }
        const beforeZoom = await scale();
        const add = page.getByRole("button", { name: "Add step", exact: true });
        await add.focus();
        await add.press("Enter");
        const choice = page
          .getByRole("complementary", { name: "What happens next?" })
          .getByRole("button", { name: /^Transform text / });
        await choice.focus();
        await choice.press("Enter");
        const name = `Audit viewport ${width} ${scheme}`;
        await page.getByRole("textbox", { name: "Step name", exact: true }).fill(name);
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(page.locator("[data-workflow-inspector]")).toBeHidden();
        const target = page
          .locator(".svelte-flow__node")
          .filter({ has: page.getByRole("button", { name: new RegExp(`^${name} `) }) });
        const action = target.getByRole("button", { name: "Add after this step", exact: true });
        await expect
          .poll(() =>
            action.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const canvas = element.closest(".workflow-canvas")!.getBoundingClientRect();
              return (
                rect.left >= canvas.left &&
                rect.right <= canvas.right &&
                rect.top >= canvas.top &&
                rect.bottom <= canvas.bottom &&
                element.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
                )
              );
            }),
          )
          .toBe(true);
        if (width === 1280) expect(await scale()).toBeCloseTo(beforeZoom, 5);
        if (width < 640 && scheme === "light") expect(await scale()).toBeLessThan(beforeZoom);
        await page.screenshot({ path: testInfo.outputPath(`appended-${width}-${scheme}.png`) });
        await action.click();
        await expect(page.getByRole("complementary", { name: "What happens next?" })).toBeVisible();
        await page
          .getByRole("complementary", { name: "What happens next?" })
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect
          .poll(async () =>
            (
              await (
                await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                  headers,
                })
              ).json()
            ).definition.steps.some((step: { name: string }) => step.name === name),
          )
          .toBe(true);
      }
    }
    const savedResponse = await request.get(
      `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(savedResponse.ok()).toBe(true);
    const saved = await savedResponse.json();
    expect(saved.definition.steps.map((step: { name: string }) => step.name)).toEqual([
      "Audit viewport 320 dark",
      "Audit viewport 320 light",
      "Audit viewport 390 dark",
      "Audit viewport 390 light",
      "Audit viewport 1280 dark",
      "Audit viewport 1280 light",
      "Audit first",
      "Audit second",
      "Transform text",
    ]);
    expect(
      saved.definition.steps
        .filter((step: { id: string }) => ["first", "second"].includes(step.id))
        .map((step: { id: string; kind: string; inputs: object }) => ({
          id: step.id,
          kind: step.kind,
          inputs: step.inputs,
        })),
    ).toEqual(
      ["first", "second"].map((id) => ({
        id,
        kind: "parse_json",
        inputs: { text: { literal: "{}" } },
      })),
    );
    expect(saved.enabled).toBe(false);
    expect(saved.published_revision).toBe(0);
    const runsResponse = await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, {
      headers,
    });
    expect(runsResponse.ok()).toBe(true);
    expect(await runsResponse.json()).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("workflow output freshness", () => {
  const warning =
    "Configuration or test data changed since this result. Run again to check the current draft.";
  for (const mode of ["test", "preview"] as const) {
    test(`${mode} output separates draft changes from immutable stored results`, async ({
      page,
      request,
    }, testInfo) => {
      const auth = await registerUser(request, `workflow-freshness-${randomUUID()}@example.com`);
      const workspace = await createWorkspace(request, auth.token, "Output freshness");
      const headers = { Authorization: `Bearer ${auth.token}` };
      const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
        headers,
        data: {
          name: "Audit output freshness",
          description: "",
          expected_revision: 0,
          definition: {
            schema: 1,
            source: { kind: "manual" },
            steps: [
              {
                id: "parse",
                name: "Audit parse",
                kind: "parse_json",
                inputs: { text: { reference: "source.body" } },
              },
              {
                id: "other",
                name: "Other parse",
                kind: "parse_json",
                inputs: { text: { literal: "{}" } },
              },
            ],
          },
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      const workflow = await response.json();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await authenticatePage(page, auth.token);
      await page.goto(`/workflows/${workflow.id}`);
      const sample =
        '{"body":"{\\"value\\":1}","__proto__":{"tag":"literal"},"constructor":"literal","a.b":"dot","list":[1,2]}';
      const reordered =
        '{"list":[1,2],"a.b":"dot","constructor":"literal","__proto__":{"tag":"literal"},"body":"{\\"value\\":1}"}';
      async function editSample(value: string) {
        await page.getByRole("button", { name: "Test data", exact: true }).click();
        await page.locator("#workflow-sample-json").fill(value);
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await page.getByRole("button", { name: /^Audit parse / }).click();
      }
      async function openDraftNode() {
        await page.getByRole("tab", { name: "Editor", exact: true }).click();
        await page.getByRole("button", { name: /^Audit parse / }).click();
      }
      async function execute() {
        if (mode === "test")
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Test node", exact: true })
            .click();
        else {
          await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
          await page.getByRole("button", { name: "Run preview", exact: true }).click();
          await expect(page.getByText("This is a preview.", { exact: false })).toBeVisible();
          await openDraftNode();
        }
      }
      const output = page.getByRole("region", { name: "Output", exact: true });
      async function checkOutput(value: number) {
        await output.getByRole("tab", { name: "JSON", exact: true }).click();
        await expect
          .poll(async () => JSON.parse(await output.locator("pre").innerText()))
          .toEqual({ data: { value } });
        await expect(output.getByText("Completed", { exact: true })).toBeVisible();
      }
      await editSample(sample);
      await execute();
      await checkOutput(1);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      const runs = await (
        await request.get(
          `/api/v1/workflow-runs?workspace_id=${workspace.id}&workflow_id=${workflow.id}`,
          { headers },
        )
      ).json();
      expect(runs).toHaveLength(1);
      const runID = runs[0].id;
      const runURL = `/api/v1/workflow-runs/${runID}?workspace_id=${workspace.id}`;
      const original = await (await request.get(runURL, { headers })).json();
      expect(original.mode).toBe(mode);
      expect(original.state).toBe("succeeded");
      expect(original.steps).toHaveLength(mode === "test" ? 1 : 2);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await editSample(reordered);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await editSample(reordered.replace("[1,2]", "[2,1]"));
      await expect(output.getByText(warning, { exact: true })).toBeVisible();
      await checkOutput(1);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await editSample(reordered);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      const field = page.getByRole("textbox", { name: "Text", exact: true });
      await field.fill('{"value":2}');
      await expect(field).toHaveText('{"value":2}');
      await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
        "Audit parse",
      );
      await expect(output.getByText(warning, { exact: true })).toBeVisible();
      await checkOutput(1);
      for (const width of [320, 390, 1280]) {
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 850 });
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
          if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
          if (width < 1024) await page.getByRole("tab", { name: "Output", exact: true }).click();
          await expect(output.getByText(warning, { exact: true })).toBeVisible();
          await page.screenshot({
            path: testInfo.outputPath(`outdated-${width}-${colorScheme}.png`),
          });
        }
      }
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await page.getByRole("tab", { name: "Runs", exact: true }).click();
      await page
        .locator('.svelte-flow__node[data-id="parse"]')
        .getByRole("button", { name: /^Audit parse / })
        .click();
      await checkOutput(1);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await openDraftNode();
      await expect(output.getByText(warning, { exact: true })).toBeVisible();
      await execute();
      await checkOutput(2);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      expect(await (await request.get(runURL, { headers })).json()).toEqual(original);
      await page.reload();
      await page.getByRole("tab", { name: "Runs", exact: true }).click();
      const historicCard = page.getByRole("button", { name: /^Completed/ }).last();
      for (const width of [320, 390, 1280]) {
        for (const colorScheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 850 });
          await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
          if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
          else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
          await expect(
            historicCard.getByText(mode === "test" ? "Test node" : "Preview", { exact: true }),
          ).toBeVisible();
          await expect(
            historicCard.getByText(`Workflow revision ${original.workflow_revision}`, {
              exact: true,
            }),
          ).toBeVisible();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`history-${mode}-${width}-${colorScheme}.png`),
          });
        }
      }
      await historicCard.focus();
      await page.keyboard.press("Enter");
      await page
        .locator('.svelte-flow__node[data-id="parse"]')
        .getByRole("button", { name: /^Audit parse / })
        .click();
      await checkOutput(1);
      await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
      expect(await (await request.get(runURL, { headers })).json()).toEqual(original);
      const saved = await (
        await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
          headers,
        })
      ).json();
      expect(saved.enabled).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("workflow post created fields", () => {
  test("post-created variables distinguish creation from publication and explain old bindings", async ({
    page,
    request,
  }, info) => {
    const auth = await registerUser(request, `created-fields-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Created fields");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit post-created fields",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "publication_created" },
          steps: [
            {
              id: "text",
              name: "Audit creation time",
              kind: "text",
              inputs: {
                text: { literal: "{{source.published_at}}" },
                operation: { literal: "trim" },
              },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
        await page.getByRole("button", { name: /^Audit creation time / }).click();
        const field = page.locator('[data-workflow-field="workflow-text"]');
        const input = field.locator('.cm-content[contenteditable="true"]');
        await expect(input).toBeVisible();
        await input.focus();
        await input.press("ControlOrMeta+A");
        await page.keyboard.type("{{source.published_at}}");
        await expect(page.locator("#workflow-text-error")).toHaveText(
          "This variable is unavailable: source.published_at",
        );
        const picker = field.getByRole("button", { name: "Insert variable", exact: true });
        await picker.focus();
        await picker.press("Enter");
        const search = page.getByRole("combobox", { name: /^Search variables/ });
        await search.fill("source.published_at");
        await expect(
          page.getByText("No matching variables. Try another search.", { exact: true }),
        ).toBeVisible();
        await search.fill("source.created_at");
        await expect(page.getByRole("option", { name: /created_at/ })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`created-${width}-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(picker).toBeFocused();
        await input.focus();
        await input.press("ControlOrMeta+A");
        await input.press("Backspace");
        await picker.focus();
        await picker.press("Enter");
        await search.fill("source.created_at");
        await search.press("Enter");
        await expect(
          field.locator('.workflow-token[aria-label="source.created_at"]'),
        ).toBeVisible();
        await expect(page.locator("#workflow-text-error")).toHaveCount(0);
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(page.locator("[data-workflow-inspector]")).not.toBeVisible();
      }
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).definition.steps[0].inputs.text.literal,
      )
      .toBe("{{source.created_at}}");
    const runs = await (
      await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
    ).json();
    expect(runs).toEqual([]);
  });
});

test.describe("workflow query loading", () => {
  test("workflow tabs read only their data and distinguish failed history from an empty list", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workflow-reads-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Workflow reads");
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Visible workflow",
        description: "",
        expected_revision: 0,
        definition: { schema: 1, source: { kind: "manual" }, steps: [] },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const workflow = await created.json();
    const unrelatedReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/accounts" || path === "/api/v1/workflow-run-summaries")
        unrelatedReads.push(path);
    });
    await authenticatePage(page, auth.token);
    await page.goto("/workflows");
    await expect(page.getByRole("link", { name: /Visible workflow/ })).toBeVisible();
    expect(unrelatedReads).toEqual([]);
    await page.getByRole("tab", { name: "Start from a template", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Use template", exact: true }).first(),
    ).toBeVisible();
    expect(unrelatedReads).toEqual([]);
    let release: () => void = () => {
      throw new Error("history request not started");
    };
    let summaryReads = 0;
    await page.route("**/api/v1/workflow-run-summaries?**", async (route) => {
      summaryReads++;
      if (summaryReads === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route.fulfill({
        status: 503,
        json: { detail: "History temporarily unavailable" },
      });
    });
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect(page.getByText("No runs yet", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Start from a template", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Use template", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    release();
    await expect(page.getByRole("alert")).toContainText("History temporarily unavailable");
    await expect(page.getByText("No runs yet", { exact: true })).toHaveCount(0);
    await page.unroute("**/api/v1/workflow-run-summaries?**");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("No runs yet", { exact: true })).toBeVisible();
    expect(unrelatedReads.filter((path) => path === "/api/v1/accounts")).toEqual([]);
    const readsBeforeEditor = unrelatedReads.filter((path) =>
      path.endsWith("workflow-run-summaries"),
    ).length;
    await page.goto(`/workflows/${workflow.id}`);
    await expect(page.getByRole("tab", { name: "Runs", exact: true })).toBeVisible();
    expect(unrelatedReads.filter((path) => path.endsWith("workflow-run-summaries"))).toHaveLength(
      readsBeforeEditor,
    );
    await page.route("**/api/v1/workflow-run-summaries?**", async (route) => {
      await route.fulfill({ status: 503, json: { detail: "Editor history unavailable" } });
    });
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Editor history unavailable");
    await expect(
      page.getByText("Preview a workflow to inspect its steps without making changes.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await page.unroute("**/api/v1/workflow-run-summaries?**");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("workflow sort types", () => {
  test("Sort explains mixed fields and recovers with numeric fields", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-sort-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Sort field types");
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      data: {
        name: "Audit sort field types",
        expected_revision: 0,
        description: "",
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "sort",
              name: "Audit sort",
              kind: "list_sort",
              inputs: {
                items: {
                  literal: [
                    { name: "N2", rank: 2 },
                    { name: "N10", rank: 10 },
                    { name: "S11", rank: "11" },
                  ],
                },
                field: { literal: "rank" },
                direction: { literal: "ascending" },
              },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const workflow = await response.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit sort / }).click();
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    await expect(
      output.getByText('field "rank" mixes text and numbers; use one type for every item', {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mixed-field-guidance.png") });
    const items = page.getByRole("textbox", { name: "Items", exact: true });
    await items.click();
    await items.press("ControlOrMeta+A");
    await items.press("Backspace");
    await items.fill(
      JSON.stringify([
        { name: "N10", rank: 10 },
        { name: "N2", rank: 2 },
      ]),
    );
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await expect(output.getByText("N2", { exact: true })).toBeVisible();
    await expect(output.getByText("N10", { exact: true })).toBeVisible();
    await output.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual({
        count: 2,
        items: [
          { name: "N2", rank: 2 },
          { name: "N10", rank: 10 },
        ],
      });
    await page.screenshot({ path: testInfo.outputPath("numeric-field-recovery.png") });
    expect(errors).toEqual([]);
  });
});

test.describe("workflow source readiness", () => {
  test("feed source explains invalid URLs before activation and recovers with keyboard correction", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const auth = await registerUser(request, `source-readiness-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Source readiness");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit feed readiness",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "rss", url: "not a url" },
          steps: [
            {
              id: "parse",
              name: "Audit inert parse",
              kind: "parse_json",
              inputs: { text: { literal: "{}" } },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    const errors: string[] = [];
    let effects = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/(publish|run|test-node)(?:\?|$)/.test(request.url()))
        effects++;
    });
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 320])
      for (const scheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const source = page.locator('.svelte-flow__node[data-id="source"]');
        await source.getByRole("button", { name: /^RSS or Atom item / }).click();
        const feed = page.getByRole("textbox", { name: "Feed URL", exact: true });
        await feed.fill("not a url");
        await expect(feed).toHaveAttribute("aria-invalid", "true");
        await expect(feed).toHaveAccessibleDescription(
          "Enter an HTTP or HTTPS URL without credentials.",
        );
        await page.screenshot({ path: testInfo.outputPath(`invalid-feed-${width}-${scheme}.png`) });
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(source).toContainText("Needs attention");
        await source.getByRole("button", { name: /^RSS or Atom item / }).click();
        for (const invalid of [
          "ftp://example.com/feed",
          "https://user:password@example.com/feed",
          "https://@example.com/feed",
          "http:example.com/feed",
        ]) {
          await feed.fill(invalid);
          await expect(feed).toHaveAttribute("aria-invalid", "true");
        }
        await feed.fill("");
        await expect(feed).toHaveAccessibleDescription("This field is required.");
        await feed.focus();
        await page.keyboard.type("https://example.com/feed.xml");
        await page.keyboard.press("Tab");
        await expect(feed).toHaveAttribute("aria-invalid", "false");
        await expect(page.locator("#workflow-feed-error")).toBeHidden();
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await expect(source).not.toContainText("Needs attention");
        await expect
          .poll(
            async () =>
              (
                await (
                  await request.get(
                    `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
                    {
                      headers,
                    },
                  )
                ).json()
              ).definition.source.url,
          )
          .toBe("https://example.com/feed.xml");
        await page.reload();
      }
    const source = page.locator('.svelte-flow__node[data-id="source"]');
    await source.getByRole("button", { name: /^RSS or Atom item / }).click();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByRole("option", { name: "Run manually", exact: true }).click();
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).definition.source.kind,
      )
      .toBe("manual");
    const saved = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(saved.enabled).toBe(false);
    expect(saved.published_revision).toBe(0);
    expect(saved.definition.steps).toEqual([
      {
        id: "parse",
        name: "Audit inert parse",
        kind: "parse_json",
        inputs: { text: { literal: "{}" } },
      },
    ]);
    expect(
      await (
        await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
      ).json(),
    ).toEqual([]);
    expect(effects).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe("workflow variable default", () => {
  test("the normal array picker replaces the list default and persists a usable typed binding", async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-picker-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Array picker");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const items = [
      { title: "B", score: 2 },
      { title: "A", score: 1 },
    ];
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit array picker",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "parse",
              name: "Audit parse",
              kind: "parse_json",
              inputs: { text: { literal: JSON.stringify(items) } },
            },
            {
              id: "sort",
              name: "Audit sort",
              kind: "list_sort",
              inputs: {
                items: { literal: [] },
                field: { literal: "score" },
                direction: { literal: "ascending" },
              },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const workflow = await response.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    await page.getByRole("button", { name: /^Audit parse / }).click();
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    await output.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual({ data: items });
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: /^Audit sort / }).click();
    const field = page.locator('[data-workflow-field="workflow-items"]');
    await field.getByRole("button", { name: "Insert variable", exact: true }).click();
    const search = page.getByRole("combobox", { name: /^Search variables/ });
    await search.fill("parse.data");
    await search.press("Enter");
    await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
    await expect(field.getByRole("status")).toHaveCount(0);
    const editor = field.getByRole("textbox", { name: "Items", exact: true });
    await editor.press("ControlOrMeta+Z");
    await expect(field.locator(".workflow-token")).toHaveCount(0);
    await expect(editor).toHaveText("[]");
    await editor.press("ControlOrMeta+Shift+Z");
    await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
    await expect
      .poll(async () => JSON.parse(await field.locator("pre").innerText()))
      .toEqual(items);
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    await output.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await output.locator("pre").innerText()))
      .toEqual({ items: [items[1], items[0]], count: 2 });
    await page.reload();
    await page.getByRole("button", { name: /^Audit sort / }).click();
    await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
    for (const width of [1280, 320]) {
      for (const colorScheme of ["light"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        if (width < 1024) await page.getByRole("tab", { name: "Configure", exact: true }).click();
        await expect(field.locator(".workflow-token")).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`typed-list-${width}-${colorScheme}.png`),
        });
      }
    }
    const saved = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(saved.definition.steps[1].inputs.items).toEqual({ reference: "parse.data" });
    expect(saved.enabled).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe("workflow variable empty help", () => {
  test("variable search names variables and recovers through keyboard selection", async ({
    page,
    request,
  }, info) => {
    test.setTimeout(600_000);
    const auth = await registerUser(request, `variable-help-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Variable search help");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit variable help",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "text",
              name: "Audit text",
              kind: "text",
              inputs: { text: { literal: "" }, operation: { literal: "trim" } },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    let tokenCount = 0;
    for (const width of [1280, 390, 320])
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.getByRole("button", { name: /^Audit text / }).click();
        const field = page.locator('[data-workflow-field="workflow-text"]');
        await expect(field).toBeVisible();
        const trigger = field.getByRole("button", { name: "Insert variable", exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const search = page.getByRole("combobox", { name: /^Search variables/ });
        await search.fill("unavailable-audit-variable");
        await expect(
          page.getByText("No matching variables. Try another search.", { exact: true }),
        ).toBeVisible();
        await page.screenshot({ path: info.outputPath(`variable-${width}-${scheme}.png`) });
        await search.fill("source.body");
        await search.press("Enter");
        tokenCount++;
        await expect(field.locator('.workflow-token[aria-label="source.body"]')).toHaveCount(
          tokenCount,
        );
        await trigger.focus();
        await trigger.press("Enter");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      }
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).definition.steps[0].inputs.text.literal,
      )
      .toBe("{{source.body}}".repeat(6));
  });
});
