import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
  await page.getByRole("button", { name: "Start from a template", exact: true }).click();
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
  await page.getByRole("button", { name: "Start from a template", exact: true }).click();
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
