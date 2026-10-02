import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("opening a workflow inspector preserves the field a user has already focused", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `workflow-focus-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Inspector focus");
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "Inspector focus audit",
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
            inputs: { text: { literal: "{}" } },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  await authenticatePage(page, auth.token);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/workflows/${workflow.id}`);
  const node = page.getByRole("button", { name: /^Audit parse / });
  await expect(node).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await node.click();
  const field = page.getByRole("textbox", { name: "Text", exact: true });
  await field.fill('{"value":2}');
  await expect(field).toBeFocused();
  // A fast user can reach a field before the dialog's first animation frame.
  await page.clock.runFor(32);
  await expect(field).toBeFocused();
  await page.keyboard.type(" ");
  await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
    "Audit parse",
  );
  await expect(field).toHaveText('{"value":2} ');
  await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
  await expect(node).toBeFocused();
  await page.clock.resume();
});
