import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  }));
  for (const account of accounts)
    execute(
      `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES (${sql(account.id)},${sql(workspace.id)},${sql(account.id)},${sql(account.platform)},${sql(account.id)},'review-founder',X'00',1);`,
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
}, info) => {
  const fixture = await pendingReview(request);
  await authenticatePage(page, fixture.auth.token);
  await page.goto(`/workflows/${fixture.workflow.id}`);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await page
        .locator("[data-workflow-editor] > header")
        .getByRole("button", { name: "Runs", exact: true })
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
      execute(
        `UPDATE publications SET revision=revision+1 WHERE id=${sql(fixture.publication.id)};`,
      );
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
      await page.screenshot({
        path: info.outputPath(`review-conflict-${width}-${scheme}.png`),
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
      await page.screenshot({
        path: info.outputPath(`review-refresh-${width}-${scheme}.png`),
      });
    }
  const run = await (
    await request.get(
      `/api/v1/workflow-runs/${fixture.runID}?workspace_id=${fixture.workspace.id}`,
      { headers: fixture.headers },
    )
  ).json();
  expect(run.state).toBe("awaiting_approval");
  expect(run.steps[0].state).toBe("awaiting_approval");
});
