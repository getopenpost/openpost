import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("pointer and keyboard canvas positions survive actual reload without revising the workflow", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-layout-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Canvas placement");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const definition = {
    schema: 1,
    source: { kind: "manual" },
    steps: [
      {
        id: "parse",
        name: "Audit placement",
        kind: "parse_json",
        inputs: { text: { literal: "{}" } },
      },
    ],
  };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: { name: "Audit canvas placement", description: "", expected_revision: 0, definition },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const workflow = await created.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  const node = page.locator('.svelte-flow__node[data-id="parse"]');
  await expect(node).toBeVisible();
  const position = () =>
    node.evaluate((element) => {
      const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: transform.m41, y: transform.m42 };
    });
  const baseline = await position();
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(position).not.toEqual(baseline);
  const pointerPosition = await position();
  await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(position).toEqual(pointerPosition);
  for (
    let count = 0;
    count < 90 && !(await node.evaluate((element) => document.activeElement === element));
    count++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(node).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  const keyboardPosition = { x: pointerPosition.x, y: pointerPosition.y + 5 };
  await expect.poll(position).toEqual(keyboardPosition);
  await page.reload();
  await expect.poll(position).toEqual(keyboardPosition);
  for (const width of [390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await expect.poll(position).toEqual(keyboardPosition);
      await expect(page.getByText("Saved in this browser", { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`canvas-cold-reload-${width}-${colorScheme}.png`),
      });
    }
  }
  const saved = await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(saved.ok()).toBeTruthy();
  const retained = await saved.json();
  expect(retained.revision).toBe(workflow.revision);
  expect(retained.definition).toEqual(workflow.definition);
  expect(retained.enabled).toBe(false);
  const runs = await request.get(
    `/api/v1/workflow-runs?workspace_id=${workspace.id}&workflow_id=${workflow.id}`,
    { headers },
  );
  expect(runs.ok()).toBeTruthy();
  expect(await runs.json()).toEqual([]);
  expect(errors).toEqual([]);
});
