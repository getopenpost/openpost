import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const editableHelp =
  "Enter or Space selects a node. Arrow keys move it; Escape clears selection. Use the step button to configure or delete the step.";
const readonlyHelp =
  "Enter or Space selects a node. Escape clears selection. Use the step button to inspect it.";

test("workflow node keyboard help describes its owning editable and read-only actions", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `node-help-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Node help");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit keyboard help",
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
            inputs: { text: { literal: "Audit" }, operation: { literal: "lowercase" } },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  const node = page.locator('.svelte-flow__node[data-id="text"]');
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await node.focus();
      await expect(node).toHaveAccessibleDescription(editableHelp);
      await node.press("Enter");
      await node.press("Delete");
      await expect(node).toBeVisible();
      await node.press("Escape");
      await expect(node).not.toHaveClass(/selected/);
      await page.screenshot({ path: info.outputPath(`help-${width}-${scheme}.png`) });
    }
  const stepButton = node.getByRole("button", { name: /^Audit text / });
  await stepButton.focus();
  await stepButton.press("Delete");
  await expect(node).toHaveCount(0);
  const more = page.getByRole("button", { name: "More actions", exact: true });
  await more.focus();
  await more.press("Enter");
  const undo = page.getByRole("menuitem", { name: "Undo", exact: true });
  await undo.focus();
  await undo.press("Enter");
  await expect(node).toBeVisible();
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  const runNode = page.locator('.svelte-flow__node[data-id="text"]');
  await expect(runNode).toHaveAccessibleDescription(readonlyHelp);
  const saved = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.enabled).toBe(false);
  expect(saved.definition.steps.map((step: { id: string }) => step.id)).toEqual(["text"]);
});
