import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
});

test.describe("workflow approval links", () => {
  test("approval links select their workspace before loading a run, including same-route navigation", async ({
    page,
    request,
  }) => {
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
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
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

test.describe("workflow graph admission", () => {
  for (const concern of ["loop", "ports"] as const) {
    test(`workflow graph ${concern} preserves authored connections`, async ({ page, request }) => {
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
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
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
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
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
