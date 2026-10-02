import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

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
      const configure = page.getByRole("button", { name: "Configure", exact: true });
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
      if (width < 1024) await page.getByRole("button", { name: "Output", exact: true }).click();
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
