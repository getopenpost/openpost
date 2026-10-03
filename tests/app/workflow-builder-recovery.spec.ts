import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await page
        .locator("[data-workflow-editor] > header")
        .getByRole("button", { name: "Runs", exact: true })
        .click();
      await page.locator("aside button").filter({ hasText: "Failed" }).click();
      await page.getByRole("button", { name: /^Audit failed build / }).click();
      if (width < 1024) await page.getByRole("button", { name: "Output", exact: true }).click();
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
