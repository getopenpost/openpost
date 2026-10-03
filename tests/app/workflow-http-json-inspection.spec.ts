import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
      const node = page.getByRole("button", { name: /^Audit JSON diagnosis / });
      await node.focus();
      await node.press("Enter");
      if (width < 1024) await page.getByRole("button", { name: "Output", exact: true }).click();
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
