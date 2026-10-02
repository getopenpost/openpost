import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Wait empty output directs to its available preview and displays the skipped wait result", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-wait-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Wait guidance");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit Wait guidance",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          { id: "wait", name: "Audit Wait", kind: "wait", inputs: { minutes: { literal: 1 } } },
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
  await page.getByRole("button", { name: /^Audit Wait / }).click();
  await expect(page.getByRole("button", { name: "Test node", exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (width < 1024) await page.getByRole("button", { name: "Output", exact: true }).click();
      await expect(
        page.getByText("Run preview to see this node's sample output.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`wait-guidance-${width}-${colorScheme}.png`),
      });
    }
  }
  await page
    .getByRole("dialog", { name: "Audit Wait", exact: true })
    .getByRole("button", { name: "Run preview", exact: true })
    .click();
  await expect(page.getByText("This is a preview.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /^Audit Wait / }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => Object.keys(JSON.parse(await output.locator("pre").innerText())))
    .toEqual(["until"]);
  const runs = await (
    await request.get(
      `/api/v1/workflow-runs?workspace_id=${workspace.id}&workflow_id=${workflow.id}`,
      { headers },
    )
  ).json();
  expect(runs).toHaveLength(1);
  expect(runs[0].mode).toBe("preview");
  expect(runs[0].state).toBe("succeeded");
  const saved = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.enabled).toBe(false);
  expect(saved.definition).toEqual(workflow.definition);
  expect(errors).toEqual([]);
});
