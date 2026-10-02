import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Saved run snapshots remain usable while switching and returning to the list", async ({
  page,
  request,
}, testInfo) => {
  const auth = await registerUser(request, `workflow-runs-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Run navigation");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const definition = (name: string) => ({
    schema: 1,
    source: { kind: "manual" },
    steps: [
      { id: "parse", name, kind: "parse_json", inputs: { text: { reference: "source.body" } } },
    ],
  });
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit run navigation",
      description: "",
      expected_revision: 0,
      definition: definition("Audit first snapshot"),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  let workflow = await created.json();
  const first = await request.post(
    `/api/v1/workflows/${workflow.id}/test-node?workspace_id=${workspace.id}`,
    {
      headers,
      data: {
        expected_revision: workflow.revision,
        step_id: "parse",
        data: { source: { body: '{"marker":"first"}' } },
      },
    },
  );
  expect(first.ok(), await first.text()).toBeTruthy();
  const firstRun = await first.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/v1/workflow-runs/${firstRun.id}?workspace_id=${workspace.id}`, {
              headers,
            })
          ).json()
        ).state,
    )
    .toBe("succeeded");
  const changed = await request.put(
    `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
    {
      headers,
      data: {
        name: workflow.name,
        description: "",
        expected_revision: workflow.revision,
        definition: definition("Audit second snapshot"),
      },
    },
  );
  expect(changed.ok(), await changed.text()).toBeTruthy();
  workflow = await changed.json();
  const second = await request.post(
    `/api/v1/workflows/${workflow.id}/test-node?workspace_id=${workspace.id}`,
    {
      headers,
      data: {
        expected_revision: workflow.revision,
        step_id: "parse",
        data: { source: { body: "{bad" } },
      },
    },
  );
  expect(second.ok(), await second.text()).toBeTruthy();
  const secondRun = await second.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `/api/v1/workflow-runs/${secondRun.id}?workspace_id=${workspace.id}`,
              { headers },
            )
          ).json()
        ).state,
    )
    .toBe("failed");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  const header = page.locator("[data-workflow-editor] > header");
  const cards = page.locator("aside button");
  const completed = cards.filter({ hasText: "Completed" });
  const failed = cards.filter({ hasText: "Failed" });
  const back = page.locator("main").getByRole("button", { name: "Runs", exact: true });
  await header.getByRole("button", { name: "Runs", exact: true }).click();
  await completed.click();
  await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
  await failed.click();
  await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
  await expect(page.getByText("text is not valid JSON", { exact: true }).first()).toBeVisible();
  await back.click();
  await expect(completed).toBeVisible();
  expect(errors).toEqual([]);
  for (const width of [1280, 390, 320]) {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 844 });
      const priorScheme = await page.locator("html").getAttribute("data-theme-scheme");
      const priorInk = await page.locator("body").evaluate((body) => getComputedStyle(body).color);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme-scheme", colorScheme);
      if (priorScheme !== colorScheme)
        await expect(page.locator("body")).not.toHaveCSS("color", priorInk);
      await completed.focus();
      await completed.press("Enter");
      await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
      await back.press("Enter");
      await expect(completed).toBeVisible();
      await failed.focus();
      await failed.press("Enter");
      await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
      await back.press("Enter");
      await expect(failed).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`run-list-${width}-${colorScheme}.png`) });
      expect(errors).toEqual([]);
    }
  }
  await page.reload();
  await header.getByRole("button", { name: "Runs", exact: true }).click();
  await completed.click();
  await expect(page.getByRole("button", { name: /^Audit first snapshot / })).toBeVisible();
  await back.click();
  await header.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Audit second snapshot / })).toBeVisible();
  expect(errors).toEqual([]);
});
