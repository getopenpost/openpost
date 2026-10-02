import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Sort explains mixed fields and recovers with numeric fields", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-sort-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Sort field types");
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "Audit sort field types",
      expected_revision: 0,
      description: "",
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "sort",
            name: "Audit sort",
            kind: "list_sort",
            inputs: {
              items: {
                literal: [
                  { name: "N2", rank: 2 },
                  { name: "N10", rank: 10 },
                  { name: "S11", rank: "11" },
                ],
              },
              field: { literal: "rank" },
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
  await page.getByRole("button", { name: /^Audit sort / }).click();
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await expect(
    output.getByText('field "rank" mixes text and numbers; use one type for every item', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mixed-field-guidance.png") });
  const items = page.getByRole("textbox", { name: "Items", exact: true });
  await items.click();
  await items.press("ControlOrMeta+A");
  await items.press("Backspace");
  await items.fill(
    JSON.stringify([
      { name: "N10", rank: 10 },
      { name: "N2", rank: 2 },
    ]),
  );
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect(output.getByText("N2", { exact: true })).toBeVisible();
  await expect(output.getByText("N10", { exact: true })).toBeVisible();
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual({
      count: 2,
      items: [
        { name: "N2", rank: 2 },
        { name: "N10", rank: 10 },
      ],
    });
  await page.screenshot({ path: testInfo.outputPath("numeric-field-recovery.png") });
  expect(errors).toEqual([]);
});
