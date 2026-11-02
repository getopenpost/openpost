import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.route(`**${detailPath}?**`, async (route) => {
    if (fullReads.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ status: 503, json: { detail: "Snapshot temporarily unavailable" } });
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
  await page.waitForTimeout(250);
  releaseAccounts();
  await page.unroute("**/api/v1/accounts?**");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByText("Snapshot temporarily unavailable", { exact: true })).toBeVisible();
  await expect(page.getByTestId("page-loading")).toBeHidden();
  const failedReads = fullReads.length;
  await page.waitForTimeout(3500);
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
