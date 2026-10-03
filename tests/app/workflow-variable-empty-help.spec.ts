import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("variable search names variables and recovers through keyboard selection", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `variable-help-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Variable search help");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit variable help",
      description: "",
      expected_revision: 0,
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
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  let tokenCount = 0;
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: /^Audit text / }).click();
      const field = page.locator('[data-workflow-field="workflow-text"]');
      const trigger = field.getByRole("button", { name: "Insert variable", exact: true });
      await trigger.focus();
      await trigger.press("Enter");
      const search = page.getByRole("combobox", { name: /^Search variables/ });
      await search.fill("unavailable-audit-variable");
      await expect(
        page.getByText("No matching variables. Try another search.", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath(`variable-${width}-${scheme}.png`) });
      await search.fill("source.body");
      await search.press("Enter");
      tokenCount++;
      await expect(field.locator('.workflow-token[aria-label="source.body"]')).toHaveCount(
        tokenCount,
      );
      await trigger.focus();
      await trigger.press("Enter");
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
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
    .toBe("{{source.body}}".repeat(6));
});
