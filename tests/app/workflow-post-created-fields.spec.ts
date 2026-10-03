import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("post-created variables distinguish creation from publication and explain old bindings", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `created-fields-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Created fields");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit post-created fields",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "publication_created" },
        steps: [
          {
            id: "text",
            name: "Audit creation time",
            kind: "text",
            inputs: {
              text: { literal: "{{source.published_at}}" },
              operation: { literal: "trim" },
            },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: /^Audit creation time / }).click();
      const field = page.locator('[data-workflow-field="workflow-text"]');
      const input = field.locator('.cm-content[contenteditable="true"]');
      await input.focus();
      await input.press("ControlOrMeta+A");
      await page.keyboard.type("{{source.published_at}}");
      await expect(page.locator("#workflow-text-error")).toHaveText(
        "This variable is unavailable: source.published_at",
      );
      const picker = field.getByRole("button", { name: "Insert variable", exact: true });
      await picker.focus();
      await picker.press("Enter");
      const search = page.getByRole("combobox", { name: /^Search variables/ });
      await search.fill("source.published_at");
      await expect(
        page.getByText("No matching variables. Try another search.", { exact: true }),
      ).toBeVisible();
      await search.fill("source.created_at");
      await expect(page.getByRole("option", { name: /created_at/ })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`created-${width}-${scheme}.png`) });
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
      await input.focus();
      await input.press("ControlOrMeta+A");
      await input.press("Backspace");
      await picker.focus();
      await picker.press("Enter");
      await search.fill("source.created_at");
      await search.press("Enter");
      await expect(field.locator('.workflow-token[aria-label="source.created_at"]')).toBeVisible();
      await expect(page.locator("#workflow-text-error")).toHaveCount(0);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    }
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json()
        ).definition.steps[0].inputs.text.literal,
    )
    .toBe("{{source.created_at}}");
  const runs = await (
    await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(runs).toEqual([]);
});
