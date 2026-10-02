import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Workspace run history restores keyboard focus to the originating card", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-run-focus-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Run focus");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit originating run",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "fields",
            name: "Audit focus data",
            kind: "set_fields",
            inputs: { fields: { literal: { marker: "focus-only" } } },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const workflow = await created.json();
  const response = await request.post(
    `/api/v1/workflows/${workflow.id}/runs?workspace_id=${workspace.id}`,
    {
      headers,
      data: {
        expected_revision: workflow.revision,
        mode: "preview",
        source: { marker: "focus-only" },
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const run = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/workflow-runs/${run.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json()
        ).state,
    )
    .toBe("succeeded");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto("/workflows");
  await page.getByRole("button", { name: "Runs", exact: true }).click();
  const card = page.getByRole("button").filter({ hasText: "Audit originating run" });
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      const priorScheme = await page.locator("html").getAttribute("data-theme-scheme");
      const priorInk = await page.locator("body").evaluate((body) => getComputedStyle(body).color);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      if (priorScheme !== colorScheme)
        await expect(page.locator("body")).not.toHaveCSS("color", priorInk);
      await card.focus();
      await card.press("Enter");
      await expect(page.getByText("Workflow revision 1 · Preview", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Runs", exact: true }).last().press("Enter");
      await expect(card).toBeFocused();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`run-focus-${width}-${colorScheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.click();
  const back = page.getByRole("button", { name: "Runs", exact: true }).last();
  await back.evaluate((button) => {
    button.focus();
    button.click();
    const laterTarget = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "New workflow",
    );
    laterTarget?.focus();
  });
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "New workflow", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
