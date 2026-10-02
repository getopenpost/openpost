import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("the normal array picker replaces the list default and persists a usable typed binding", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-picker-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Array picker");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const items = [
    { title: "B", score: 2 },
    { title: "A", score: 1 },
  ];
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit array picker",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "parse",
            name: "Audit parse",
            kind: "parse_json",
            inputs: { text: { literal: JSON.stringify(items) } },
          },
          {
            id: "sort",
            name: "Audit sort",
            kind: "list_sort",
            inputs: {
              items: { literal: [] },
              field: { literal: "score" },
              direction: { literal: "ascending" },
            },
          },
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
  await page.getByRole("button", { name: /^Audit parse / }).click();
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual({ data: items });
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Audit sort / }).click();
  const field = page.locator('[data-workflow-field="workflow-items"]');
  await field.getByRole("button", { name: "Insert variable", exact: true }).click();
  const search = page.getByRole("combobox", { name: /^Search variables/ });
  await search.fill("parse.data");
  await search.press("Enter");
  await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
  await expect(field.getByRole("status")).toHaveCount(0);
  const editor = field.getByRole("textbox", { name: "Items", exact: true });
  await editor.press("ControlOrMeta+Z");
  await expect(field.locator(".workflow-token")).toHaveCount(0);
  await expect(editor).toHaveText("[]");
  await editor.press("ControlOrMeta+Shift+Z");
  await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
  await expect.poll(async () => JSON.parse(await field.locator("pre").innerText())).toEqual(items);
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual({ items: [items[1], items[0]], count: 2 });
  await page.reload();
  await page.getByRole("button", { name: /^Audit sort / }).click();
  await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "parse.data");
  for (const width of [320, 390, 1280]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (width < 1024) await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(field.locator(".workflow-token")).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`typed-list-${width}-${colorScheme}.png`),
      });
    }
  }
  const saved = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.definition.steps[1].inputs.items).toEqual({ reference: "parse.data" });
  expect(saved.enabled).toBe(false);
  expect(errors).toEqual([]);
});
