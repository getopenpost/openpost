import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("appending a workflow step keeps its next action inside the canvas", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const auth = await registerUser(request, `canvas-append-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Canvas append");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit append viewport",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: ["first", "second"].map((id) => ({
          id,
          name: `Audit ${id}`,
          kind: "parse_json",
          inputs: { text: { literal: "{}" } },
        })),
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  await authenticatePage(page, auth.token);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/workflows/${workflow.id}`);
  await page
    .locator('.svelte-flow__node[data-id="second"]')
    .getByRole("button", { name: "Add after this step", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "What happens next?" })
    .getByRole("button", { name: /^Transform text / })
    .click();
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Transform text",
  );
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  const node = page
    .locator(".svelte-flow__node")
    .filter({ has: page.getByRole("button", { name: /^Transform text / }) });
  const next = node.getByRole("button", { name: "Add after this step", exact: true });
  await expect(page.locator("[data-workflow-inspector]")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("appended-step.png") });
  await expect
    .poll(() =>
      next.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const canvas = element.closest(".workflow-canvas")!.getBoundingClientRect();
        return (
          bounds.left >= canvas.left &&
          bounds.right <= canvas.right &&
          bounds.top >= canvas.top &&
          bounds.bottom <= canvas.bottom &&
          element.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          )
        );
      }),
    )
    .toBe(true);
  await next.click();
  await expect(page.getByRole("complementary", { name: "What happens next?" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "What happens next?" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  for (const width of [1280, 390, 320]) {
    for (const scheme of ["light", "dark"] as const) {
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                  headers,
                })
              ).json()
            ).definition.steps.length,
        )
        .toBeGreaterThanOrEqual(3);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(page.getByRole("button", { name: "Add step", exact: true })).toBeVisible();
      if (width < 640 && scheme === "light") {
        for (let i = 0; i < 3; i++)
          await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      }
      const scale = () =>
        page
          .locator(".svelte-flow__viewport")
          .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
      const beforeZoom = await scale();
      const add = page.getByRole("button", { name: "Add step", exact: true });
      await add.focus();
      await add.press("Enter");
      const choice = page
        .getByRole("complementary", { name: "What happens next?" })
        .getByRole("button", { name: /^Transform text / });
      await choice.focus();
      await choice.press("Enter");
      const name = `Audit viewport ${width} ${scheme}`;
      await page.getByRole("textbox", { name: "Step name", exact: true }).fill(name);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(page.locator("[data-workflow-inspector]")).toBeHidden();
      const target = page
        .locator(".svelte-flow__node")
        .filter({ has: page.getByRole("button", { name: new RegExp(`^${name} `) }) });
      const action = target.getByRole("button", { name: "Add after this step", exact: true });
      await expect
        .poll(() =>
          action.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const canvas = element.closest(".workflow-canvas")!.getBoundingClientRect();
            return (
              rect.left >= canvas.left &&
              rect.right <= canvas.right &&
              rect.top >= canvas.top &&
              rect.bottom <= canvas.bottom &&
              element.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              )
            );
          }),
        )
        .toBe(true);
      if (width === 1280) expect(await scale()).toBeCloseTo(beforeZoom, 5);
      if (width < 640 && scheme === "light") expect(await scale()).toBeLessThan(beforeZoom);
      await page.screenshot({ path: testInfo.outputPath(`appended-${width}-${scheme}.png`) });
      await action.click();
      await expect(page.getByRole("complementary", { name: "What happens next?" })).toBeVisible();
      await page
        .getByRole("complementary", { name: "What happens next?" })
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await expect
        .poll(async () =>
          (
            await (
              await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                headers,
              })
            ).json()
          ).definition.steps.some((step: { name: string }) => step.name === name),
        )
        .toBe(true);
    }
  }
  const savedResponse = await request.get(
    `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
    { headers },
  );
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.json();
  expect(saved.definition.steps.map((step: { name: string }) => step.name)).toEqual([
    "Audit viewport 320 dark",
    "Audit viewport 320 light",
    "Audit viewport 390 dark",
    "Audit viewport 390 light",
    "Audit viewport 1280 dark",
    "Audit viewport 1280 light",
    "Audit first",
    "Audit second",
    "Transform text",
  ]);
  expect(
    saved.definition.steps
      .filter((step: { id: string }) => ["first", "second"].includes(step.id))
      .map((step: { id: string; kind: string; inputs: object }) => ({
        id: step.id,
        kind: step.kind,
        inputs: step.inputs,
      })),
  ).toEqual(
    ["first", "second"].map((id) => ({
      id,
      kind: "parse_json",
      inputs: { text: { literal: "{}" } },
    })),
  );
  expect(saved.enabled).toBe(false);
  expect(saved.published_revision).toBe(0);
  const runsResponse = await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, {
    headers,
  });
  expect(runsResponse.ok()).toBe(true);
  expect(await runsResponse.json()).toEqual([]);
  expect(errors).toEqual([]);
});
