import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Edit fields preview preserves escaping and whole-value types through execution", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-json-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "JSON preview");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const phrase = 'He said "Café"\\folder\n東京 👋';
  const source = { phrase, object: { text: phrase, values: [1, false, null] } };
  const authored = '{"copied":"{{source.phrase}}","nested":["prefix {{source.phrase}} suffix"]}';
  const expected = { copied: phrase, nested: [`prefix ${phrase} suffix`] };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit JSON preview",
      expected_revision: 0,
      description: "",
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "fields",
            name: "Audit fields",
            kind: "set_fields",
            inputs: { fields: { literal: authored } },
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
  await page.locator("#workflow-sample-json").fill(JSON.stringify(source));
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Audit fields / }).click();
  const field = page.locator('[data-workflow-field="workflow-fields"]');
  const preview = field.locator("pre");
  await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(expected);
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual(expected);
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(expected);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`json-preview-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const editor = field.getByRole("textbox");
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await editor.press("Backspace");
  await editor.pressSequentially('{"copied":');
  await expect(field.getByRole("status")).toHaveText("Enter valid JSON.");
  await expect(preview).toHaveCount(0);
  await editor.press("ControlOrMeta+A");
  await editor.press("Backspace");
  await field.getByRole("button", { name: "Insert variable", exact: true }).click();
  await page.getByRole("combobox", { name: /^Search variables/ }).fill("source.object");
  await page.getByRole("combobox", { name: /^Search variables/ }).press("Enter");
  await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(source.object);
  await expect
    .poll(async () => {
      const saved = await (
        await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
          headers,
        })
      ).json();
      return saved.definition.steps[0].inputs.fields;
    })
    .toEqual({ reference: "source.object" });
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual(source.object);
  await page.reload();
  await page.getByRole("button", { name: /^Audit fields / }).click();
  await expect(field.locator(".workflow-token")).toHaveAttribute("aria-label", "source.object");
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: "Test data", exact: true }).click();
  await page.locator("#workflow-sample-json").fill(JSON.stringify(source));
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await page.getByRole("button", { name: /^Audit fields / }).click();
  await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(source.object);
  expect(errors).toEqual([]);
});
