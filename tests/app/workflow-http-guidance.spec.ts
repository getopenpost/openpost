import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
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
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.enabled).toBe(false);
  expect(runs).toHaveLength(2);
});
