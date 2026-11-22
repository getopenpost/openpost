import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test.describe("workflow automatic empty runs", () => {
  test("empty active schedule history explains timing without activating or running it", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `timer-help-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Timer waiting help");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit waiting schedule",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "interval", interval_minutes: 5 },
          steps: [
            {
              id: "fields",
              name: "Audit fields",
              kind: "set_fields",
              inputs: { fields: { literal: { audit: "safe fixture" } } },
            },
          ],
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const workflow = await response.json();
    const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
    // Seed a read-only active snapshot, not activation. A future baseline prevents timer admission.
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      database,
      `UPDATE workflows SET enabled=1,published_revision=revision,published_json=draft_json,source_started_at='2100-01-01T00:00:00Z',last_checked_at='2100-01-01T00:00:00Z' WHERE id='${workflow.id}';`,
    ]);
    try {
      await authenticatePage(page, auth.token);
      await page.goto(`/workflows/${workflow.id}`);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload();
      await page
        .locator("[data-workflow-editor] > header")
        .getByRole("tab", { name: "Runs", exact: true })
        .click();
      await expect(
        page.getByText(
          "This schedule is active. Its first run starts after 5 minutes and the next background check.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Preview a workflow to inspect its steps without making changes.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await page.goto("/workflows");
      await page.getByRole("tab", { name: "Runs", exact: true }).click();
      await expect(
        page.getByText("Runs appear here when an active workflow's published trigger fires.", {
          exact: true,
        }),
      ).toBeVisible();
      const changed = await request.put(
        `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
        {
          headers,
          data: {
            name: workflow.name,
            description: "",
            expected_revision: workflow.revision,
            definition: {
              ...workflow.definition,
              source: { kind: "interval", interval_minutes: 30 },
            },
          },
        },
      );
      expect(changed.ok(), await changed.text()).toBe(true);
      const changedDraft = await changed.json();
      expect(changedDraft.published_revision).toBe(workflow.revision);
      expect(changedDraft.revision).toBeGreaterThan(changedDraft.published_revision);
      await page.goto(`/workflows/${workflow.id}`);
      await page
        .locator("[data-workflow-editor] > header")
        .getByRole("tab", { name: "Runs", exact: true })
        .click();
      await expect(
        page.getByText("Runs appear here when an active workflow's published trigger fires.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(/^This schedule is active\./)).toHaveCount(0);
      expect(
        await (
          await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
        ).json(),
      ).toEqual([]);
    } finally {
      execFileSync("sqlite3", [
        "-cmd",
        ".timeout 5000",
        database,
        `UPDATE workflows SET enabled=0 WHERE id='${workflow.id}';`,
      ]);
    }
    const restored = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(restored.enabled).toBe(false);
    await page.reload();
    await page
      .locator("[data-workflow-editor] > header")
      .getByRole("tab", { name: "Runs", exact: true })
      .click();
    await expect(
      page.getByText("Preview a workflow to inspect its steps without making changes.", {
        exact: true,
      }),
    ).toBeVisible();
  });
});

test.describe("workflow review recovery", () => {
  const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  const execute = (statement: string) =>
    execFileSync("sqlite3", ["-cmd", ".timeout 5000", databasePath, statement]);

  async function pendingReview(request: APIRequestContext) {
    const auth = await registerUser(request, `review-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Review recovery");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const accounts = ["bluesky", "threads"].map((platform) => ({
      id: randomUUID(),
      platform,
      slug: `review-${platform}`,
    }));
    for (const account of accounts)
      execute(
        `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES (${sql(account.id)},${sql(workspace.id)},${sql(account.slug)},${sql(account.platform)},${sql(account.id)},'review-founder',X'00',1);`,
      );
    const createdPost = await request.post("/api/v1/publications", {
      headers,
      data: {
        workspace_id: workspace.id,
        content_profile: "text",
        creation_preset: "post",
        title: "Review duplicate 東京",
        source_text: "Review duplicate 東京",
        renditions: accounts.map((account) => ({
          social_account_id: account.id,
        })),
      },
    });
    expect(createdPost.ok(), await createdPost.text()).toBe(true);
    const publication = await createdPost.json();
    const definition = {
      schema: 1,
      source: { kind: "manual" },
      steps: [
        {
          id: "review",
          kind: "approval",
          name: "Audit pending review",
          inputs: { publication_id: { literal: publication.id } },
        },
      ],
    };
    const createdWorkflow = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit pending review",
        description: "",
        expected_revision: 0,
        definition,
      },
    });
    expect(createdWorkflow.ok(), await createdWorkflow.text()).toBe(true);
    const workflow = await createdWorkflow.json();
    const now = new Date().toISOString(),
      runID = randomUUID();
    const steps = [
      {
        step_id: "review",
        kind: "approval",
        name: "Audit pending review",
        state: "awaiting_approval",
        inputs: { publication_id: publication.id },
        output: {},
        started_at: now,
      },
    ];
    // Only pending review is seeded. Reads and stale-revision approval use the real
    // authorized API. The graph has no descendants and no approval is dispatched.
    execute(
      `INSERT INTO workflow_runs (id,workflow_id,workspace_id,workflow_name,workflow_revision,mode,state,definition_json,authority_json,source_json,remaining_json,results_json,current_step_id,error,created_at,updated_at) VALUES (${sql(runID)},${sql(workflow.id)},${sql(workspace.id)},${sql(workflow.name)},${workflow.revision},'live','awaiting_approval',${sql(JSON.stringify(definition))},'{}','{}','[]',${sql(JSON.stringify(steps))},'review','',${sql(now)},${sql(now)});`,
    );
    return { auth, workspace, headers, workflow, publication, runID };
  }

  test("stale approval explains the changed post and refreshes the displayed revision without dispatch", async ({
    page,
    request,
  }) => {
    const fixture = await pendingReview(request);
    await authenticatePage(page, fixture.auth.token);
    await page.goto(`/workflows/${fixture.workflow.id}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page
      .locator("[data-workflow-editor] > header")
      .getByRole("tab", { name: "Runs", exact: true })
      .click();
    await page.locator("aside button").filter({ hasText: "Needs approval" }).click();
    const approval = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Review post", exact: true }),
    });
    await expect(approval).toContainText("Review duplicate 東京");
    const before = await (
      await request.get(`/api/v1/publications/${fixture.publication.id}`, {
        headers: fixture.headers,
      })
    ).json();
    execute(`UPDATE publications SET revision=revision+1 WHERE id=${sql(fixture.publication.id)};`);
    const approve = approval.getByRole("button", {
      name: "Approve shown revision",
      exact: true,
    });
    await approve.focus();
    await approve.press("Enter");
    await expect(
      page.getByText(
        "the post changed; refresh the post and review its current revision before approving",
        { exact: true },
      ),
    ).toBeVisible();
    const refresh = approval.getByRole("button", {
      name: "Refresh",
      exact: true,
    });
    await refresh.focus();
    await refresh.press("Enter");
    await expect(approval).toContainText(`Post revision ${before.revision + 1}`);
    await expect(
      page.getByText(
        "the post changed; refresh the post and review its current revision before approving",
        { exact: true },
      ),
    ).toHaveCount(0);
    const run = await (
      await request.get(
        `/api/v1/workflow-runs/${fixture.runID}?workspace_id=${fixture.workspace.id}`,
        { headers: fixture.headers },
      )
    ).json();
    expect(run.state).toBe("awaiting_approval");
    expect(run.steps[0].state).toBe("awaiting_approval");
  });

  test("review destinations show resolved account names and each distinct content field once", async ({
    page,
    request,
  }) => {
    const fixture = await pendingReview(request);
    await authenticatePage(page, fixture.auth.token);
    await page.goto("/workflows");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    await page.getByRole("button").filter({ hasText: "Audit pending review" }).click();
    const approval = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Review post", exact: true }),
    });
    const destinations = approval.locator("article");
    await expect(destinations).toHaveCount(2);
    await expect(destinations.nth(0).getByRole("heading", { level: 5 })).toHaveAccessibleName(
      "review-bluesky",
    );
    await expect(destinations.nth(1).getByRole("heading", { level: 5 })).toHaveAccessibleName(
      "review-threads",
    );
    for (const destination of await destinations.all())
      await expect(destination.getByText("Review duplicate 東京", { exact: true })).toHaveCount(1);
    const updated = await request.put(`/api/v1/publications/${fixture.publication.id}`, {
      headers: fixture.headers,
      data: {
        expected_revision: fixture.publication.revision,
        renditions: fixture.publication.renditions.map(
          (rendition: {
            social_account_id: string;
            output_profile: string;
            segments: { publication_segment_id: string }[];
          }) => ({
            social_account_id: rendition.social_account_id,
            output_profile: rendition.output_profile,
            segments: rendition.segments.map((segment) => ({
              publication_segment_id: segment.publication_segment_id,
              title_override: "Distinct review title",
            })),
          }),
        ),
      },
    });
    expect(updated.ok(), await updated.text()).toBe(true);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const content = page.locator("section article");
    for (const destination of await content.all()) {
      await expect(destination.getByText("Distinct review title", { exact: true })).toHaveCount(1);
      await expect(destination.getByText("Review duplicate 東京", { exact: true })).toHaveCount(1);
      await expect(destination.getByText("Title", { exact: true })).toBeVisible();
      await expect(destination.getByText("Body", { exact: true })).toBeVisible();
    }
  });
});

test.describe("workflow run focus", () => {
  test("Workspace run history restores keyboard focus to the originating card", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workflow-run-focus-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Run focus");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit originating run",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "fields",
              name: "Audit focus data",
              kind: "set_fields",
              inputs: { fields: { literal: { marker: "focus-only" } } },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const workflow = await created.json();
    const response = await request.post(
      `/api/v1/workflows/${workflow.id}/runs?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          expected_revision: workflow.revision,
          mode: "preview",
          source: { marker: "focus-only" },
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    const run = await response.json();
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto("/workflows");
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    const card = page.getByRole("button").filter({ hasText: "Audit originating run" });
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await card.focus();
    await card.press("Enter");
    await expect(page.getByText("Workflow revision 1 · Preview", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Runs", exact: true }).last().press("Enter");
    await expect(card).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await card.click();
    const back = page.getByRole("button", { name: "Runs", exact: true }).last();
    await back.evaluate((button) => {
      button.focus();
      button.click();
      const laterTarget = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "New workflow",
      );
      laterTarget?.focus();
    });
    await expect(card).toBeVisible();
    await expect(page.getByRole("button", { name: "New workflow", exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test.describe("workflow run navigation", () => {
  test("Saved run snapshots remain usable while switching and returning to the list", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workflow-runs-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Run navigation");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const definition = (name: string) => ({
      schema: 1,
      source: { kind: "manual" },
      steps: [
        { id: "parse", name, kind: "parse_json", inputs: { text: { reference: "source.body" } } },
      ],
    });
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit run navigation",
        description: "",
        expected_revision: 0,
        definition: definition("Audit first snapshot"),
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    let workflow = await created.json();
    const first = await request.post(
      `/api/v1/workflows/${workflow.id}/test-node?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          expected_revision: workflow.revision,
          step_id: "parse",
          data: { source: { body: '{"marker":"first"}' } },
        },
      },
    );
    expect(first.ok(), await first.text()).toBeTruthy();
    const firstRun = await first.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `/api/v1/workflow-runs/${firstRun.id}?workspace_id=${workspace.id}`,
                {
                  headers,
                },
              )
            ).json()
          ).state,
      )
      .toBe("succeeded");
    const changed = await request.put(
      `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          name: workflow.name,
          description: "",
          expected_revision: workflow.revision,
          definition: definition("Audit second snapshot"),
        },
      },
    );
    expect(changed.ok(), await changed.text()).toBeTruthy();
    workflow = await changed.json();
    const second = await request.post(
      `/api/v1/workflows/${workflow.id}/test-node?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          expected_revision: workflow.revision,
          step_id: "parse",
          data: { source: { body: "{bad" } },
        },
      },
    );
    expect(second.ok(), await second.text()).toBeTruthy();
    const secondRun = await second.json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(
                `/api/v1/workflow-runs/${secondRun.id}?workspace_id=${workspace.id}`,
                { headers },
              )
            ).json()
          ).state,
      )
      .toBe("failed");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    const header = page.locator("[data-workflow-editor] > header");
    const cards = page.locator("aside button");
    const completed = cards.filter({ hasText: "Completed" });
    const failed = cards.filter({ hasText: "Failed" });
    const back = page.locator("main").getByRole("button", { name: "Runs", exact: true });
    await header.getByRole("tab", { name: "Runs", exact: true }).click();
    await completed.click();
    await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
    await failed.click();
    await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
    await expect(page.getByText("text is not valid JSON", { exact: true }).first()).toBeVisible();
    await back.click();
    await expect(completed).toBeVisible();
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", "light");
    await completed.focus();
    await completed.press("Enter");
    await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
    await back.press("Enter");
    await expect(completed).toBeVisible();
    await failed.focus();
    await failed.press("Enter");
    await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
    await back.press("Enter");
    await expect(failed).toBeVisible();
    expect(errors).toEqual([]);
    await page.reload();
    await header.getByRole("tab", { name: "Runs", exact: true }).click();
    await completed.click();
    await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
    await back.click();
    await header.getByRole("tab", { name: "Editor", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("workflow run summaries", () => {
  test("run cards load summaries and recover a failed full snapshot without losing history", async ({
    page,
    request,
  }) => {
    const auth = await registerUser(request, `workflow-summary-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Summary history");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Summary payload audit",
        description: "",
        expected_revision: 0,
        definition: {
          schema: 1,
          source: { kind: "manual" },
          steps: [
            {
              id: "parse",
              name: "Preserved output",
              kind: "parse_json",
              inputs: { text: { reference: "source.body" } },
            },
          ],
        },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const workflow = await created.json();
    const source = { marker: "Full history survives", body: "x".repeat(32 * 1024) };
    const started = await request.post(
      `/api/v1/workflows/${workflow.id}/test-node?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          expected_revision: workflow.revision,
          step_id: "parse",
          data: { source: { body: JSON.stringify(source) } },
        },
      },
    );
    expect(started.ok(), await started.text()).toBeTruthy();
    const run = await started.json();
    const detailPath = `/api/v1/workflow-runs/${run.id}`;
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`${detailPath}?workspace_id=${workspace.id}`, { headers })
            ).json()
          ).state,
      )
      .toBe("succeeded");
    const fullReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/workflow-runs" || path.startsWith("/api/v1/workflow-runs/"))
        fullReads.push(path);
    });
    await authenticatePage(page, auth.token);
    await page.goto("/workflows");
    await page.getByRole("tab", { name: "Runs", exact: true }).click();
    const card = page.getByRole("button", { name: /Summary payload audit/ });
    await expect(card).toBeVisible();
    expect(fullReads).toEqual([]);
    const summaries = await request.get(
      `/api/v1/workflow-run-summaries?workspace_id=${workspace.id}`,
      { headers },
    );
    expect(summaries.ok()).toBeTruthy();
    expect((await summaries.body()).length).toBeLessThan(4096);
    let release: () => void = () => {
      throw new Error("detail has not started");
    };
    let failedSnapshots = 0;
    await page.route(`**${detailPath}?**`, async (route) => {
      if (fullReads.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route.fulfill({ status: 503, json: { detail: "Snapshot temporarily unavailable" } });
      failedSnapshots++;
    });
    let releaseAccounts: () => void = () => {
      throw new Error("accounts have not started");
    };
    let accountsStarted = false;
    await page.route("**/api/v1/accounts?**", async (route) => {
      accountsStarted = true;
      await new Promise<void>((resolve) => {
        releaseAccounts = resolve;
      });
      await route.continue();
    });
    await card.click();
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect.poll(() => accountsStarted && fullReads.length === 1).toBe(true);
    release();
    await expect.poll(() => fullReads.length).toBe(2);
    // Keep accounts pending until the snapshot has exhausted its one automatic retry.
    await expect.poll(() => failedSnapshots).toBe(2);
    releaseAccounts();
    await page.unroute("**/api/v1/accounts?**");
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(page.getByText("Snapshot temporarily unavailable", { exact: true })).toBeVisible();
    await expect(page.getByTestId("page-loading")).toBeHidden();
    const failedReads = fullReads.length;
    // Proving a negative: no automatic retry may arrive within a bounded window.
    await expect
      .poll(() => fullReads.length, { timeout: 3500 })
      .not.toBe(failedReads)
      .catch(() => {});
    expect(fullReads).toHaveLength(failedReads);
    await expect(page.getByText("Snapshot temporarily unavailable", { exact: true })).toBeVisible();
    await page.unroute(`**${detailPath}?**`);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    const details = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "Preserved output" }) });
    await details.locator("summary").click();
    await expect(details.getByText("Outputs", { exact: true })).toBeVisible();
    await expect(details.locator("pre").last()).toContainText("Full history survives");
    await expect(details.locator("pre").last()).toContainText(source.body);
    expect(fullReads.every((path) => path === detailPath)).toBe(true);
    await page.getByRole("button", { name: "Runs", exact: true }).last().click();
    await expect(card).toBeVisible();
  });
});
