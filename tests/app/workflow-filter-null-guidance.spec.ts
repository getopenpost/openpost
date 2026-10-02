import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Filter distinguishes present null from absent and allows correction", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-null-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Filter null guidance");
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "Audit filter null guidance",
      expected_revision: 0,
      description: "",
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "filter",
            name: "Audit filter",
            kind: "list_filter",
            inputs: {
              items: { literal: [{ id: "present", value: null }] },
              field: { literal: "value" },
              operator: { literal: "equals" },
              right: { literal: 2 },
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
  await page.getByRole("button", { name: /^Audit filter / }).click();
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  const nullError = output.getByText("field item.value is null; provide a non-null value", {
    exact: true,
  });
  await expect(nullError).toBeVisible();
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await expect(nullError).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`filter-null-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const items = page.getByRole("textbox", { name: "Items", exact: true });
  await items.fill('[{"id":"absent"}]');
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect(output.getByText("field item.value is missing", { exact: true })).toBeVisible();
  await items.fill('[{"id":"recovered","value":2}]');
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  await expect(output.getByText("recovered", { exact: true })).toBeVisible();
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual({ count: 1, items: [{ id: "recovered", value: 2 }] });
  await page.screenshot({ path: testInfo.outputPath("filter-numeric-recovery.png") });
  expect(errors).toEqual([]);
});
