import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Merge explains nested replacement before execution", async ({ page, request }, testInfo) => {
  const auth = await registerUser(request, `workflow-merge-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Merge replacement guidance");
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "Audit merge guidance",
      expected_revision: 0,
      description: "",
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "merge",
            name: "Audit merge",
            kind: "merge",
            inputs: {
              first: {
                literal: {
                  settings: { kept: true, left: 1 },
                  label: "left",
                  nullPreserved: null,
                  list: [1, 2],
                },
              },
              second: { literal: { settings: { right: 2 }, label: "right", list: [3] } },
            },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const workflow = await response.json();
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  await page.getByRole("button", { name: /^Audit merge / }).click();
  const guidance = page.getByText(
    /second input replaces matching top-level values, including entire nested objects and lists/,
  );
  await expect(guidance).toBeVisible();
  for (const width of [390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      await page.getByRole("button", { name: "Configure", exact: true }).click();
      await expect(guidance).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`merge-guidance-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Test node", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await expect(output.getByText("right", { exact: true })).toBeVisible();
  await output.getByRole("button", { name: "JSON", exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await output.locator("pre").innerText()))
    .toEqual({
      data: {
        settings: { right: 2 },
        label: "right",
        nullPreserved: null,
        list: [3],
      },
    });
  await page.screenshot({ path: testInfo.outputPath("merge-replacement-output.png") });
});
