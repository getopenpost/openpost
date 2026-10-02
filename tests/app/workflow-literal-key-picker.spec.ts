import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("literal dotted keys and nested paths remain distinct picker references", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-keys-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Literal key references");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit literal keys",
      expected_revision: 0,
      description: "",
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "text",
            name: "Audit text",
            kind: "text",
            inputs: { text: { literal: "" }, operation: { literal: "trim" } },
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
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page
    .locator("#workflow-sample-json")
    .fill(JSON.stringify({ "a.b": "DOT", a: { b: "NEST" } }));
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Audit text / }).click();
  const field = page.locator('[data-workflow-field="workflow-text"]');
  await field.getByRole("button", { name: "Insert variable", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /^Search variables/ })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByRole("option").filter({ hasText: 'source["a.b"]' })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "source.a.b" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field.getByRole("button", { name: "Insert variable", exact: true })).toBeFocused();
  const input = page.getByRole("region", { name: "Input", exact: true });
  await expect(input.getByText('source["a.b"]', { exact: true })).toBeVisible();
  await expect(input.getByText("source.a.b", { exact: true })).toBeVisible();
  for (const [reference, expected] of [
    ['source["a.b"]', "DOT"],
    ["source.a.b", "NEST"],
  ]) {
    await field.getByRole("textbox").click();
    await field.getByRole("textbox").press("ControlOrMeta+A");
    await field.getByRole("textbox").press("Backspace");
    await field.getByRole("button", { name: "Insert variable", exact: true }).click();
    const search = page.getByRole("combobox", { name: /^Search variables/ });
    await search.fill(reference);
    if (expected === "DOT") await search.press("Enter");
    else await page.getByRole("option").filter({ hasText: reference }).click();
    await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", reference);
    await expect(field.getByText(expected, { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const saved = await (
          await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
            headers,
          })
        ).json();
        return saved.definition.steps[0].inputs.text.literal;
      })
      .toBe(`{{${reference}}}`);
    await page.getByRole("button", { name: "Test node", exact: true }).click();
    const output = page.getByRole("region", { name: "Output", exact: true });
    await expect(output.getByText(expected, { exact: true })).toBeVisible({ timeout: 30000 });
  }
  expect(errors).toEqual([]);
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await field.getByRole("button", { name: "Insert variable", exact: true }).click();
      await expect(page.getByRole("option").filter({ hasText: 'source["a.b"]' })).toBeVisible();
      await expect(page.getByRole("option").filter({ hasText: "source.a.b" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`distinct-reference-picker-${width}-${colorScheme}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        field.getByRole("button", { name: "Insert variable", exact: true }),
      ).toBeFocused();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
