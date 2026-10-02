import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const warning =
  "Configuration or test data changed since this result. Run again to check the current draft.";
for (const mode of ["test", "preview"] as const) {
  test(`${mode} output separates draft changes from immutable stored results`, async ({
    page,
    request,
  }, testInfo) => {
    const auth = await registerUser(request, `workflow-freshness-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Output freshness");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: {
        name: "Audit output freshness",
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
              inputs: { text: { reference: "source.body" } },
            },
            {
              id: "other",
              name: "Other parse",
              kind: "parse_json",
              inputs: { text: { literal: "{}" } },
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
    const sample =
      '{"body":"{\\"value\\":1}","__proto__":{"tag":"literal"},"constructor":"literal","a.b":"dot","list":[1,2]}';
    const reordered =
      '{"list":[1,2],"a.b":"dot","constructor":"literal","__proto__":{"tag":"literal"},"body":"{\\"value\\":1}"}';
    async function editSample(value: string) {
      await page.getByRole("button", { name: "Test data", exact: true }).click();
      await page.locator("#workflow-sample-json").fill(value);
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await page.getByRole("button", { name: /^Audit parse / }).click();
    }
    async function openDraftNode() {
      await page.getByRole("button", { name: "Editor", exact: true }).click();
      await page.getByRole("button", { name: /^Audit parse / }).click();
    }
    async function execute() {
      if (mode === "test")
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Test node", exact: true })
          .click();
      else {
        await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
        await page.getByRole("button", { name: "Run preview", exact: true }).click();
        await expect(page.getByText("This is a preview.", { exact: false })).toBeVisible();
        await openDraftNode();
      }
    }
    const output = page.getByRole("region", { name: "Output", exact: true });
    async function checkOutput(value: number) {
      await output.getByRole("button", { name: "JSON", exact: true }).click();
      await expect
        .poll(async () => JSON.parse(await output.locator("pre").innerText()))
        .toEqual({ data: { value } });
      await expect(output.getByText("Completed", { exact: true })).toBeVisible();
    }
    await editSample(sample);
    await execute();
    await checkOutput(1);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    const runs = await (
      await request.get(
        `/api/v1/workflow-runs?workspace_id=${workspace.id}&workflow_id=${workflow.id}`,
        { headers },
      )
    ).json();
    expect(runs).toHaveLength(1);
    const runID = runs[0].id;
    const runURL = `/api/v1/workflow-runs/${runID}?workspace_id=${workspace.id}`;
    const original = await (await request.get(runURL, { headers })).json();
    expect(original.mode).toBe(mode);
    expect(original.state).toBe("succeeded");
    expect(original.steps).toHaveLength(mode === "test" ? 1 : 2);
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await editSample(reordered);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await editSample(reordered.replace("[1,2]", "[2,1]"));
    await expect(output.getByText(warning, { exact: true })).toBeVisible();
    await checkOutput(1);
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await editSample(reordered);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    const field = page.getByRole("textbox", { name: "Text", exact: true });
    await field.fill('{"value":2}');
    await expect(field).toHaveText('{"value":2}');
    await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
      "Audit parse",
    );
    await expect(output.getByText(warning, { exact: true })).toBeVisible();
    await checkOutput(1);
    for (const width of [320, 390, 1280]) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        if (width < 1024) await page.getByRole("button", { name: "Output", exact: true }).click();
        await expect(output.getByText(warning, { exact: true })).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`outdated-${width}-${colorScheme}.png`),
        });
      }
    }
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await page
      .locator('.svelte-flow__node[data-id="parse"]')
      .getByRole("button", { name: /^Audit parse / })
      .click();
    await checkOutput(1);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
    await openDraftNode();
    await expect(output.getByText(warning, { exact: true })).toBeVisible();
    await execute();
    await checkOutput(2);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    expect(await (await request.get(runURL, { headers })).json()).toEqual(original);
    await page.reload();
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    const historicCard = page.getByRole("button", { name: /^Completed/ }).last();
    for (const width of [320, 390, 1280]) {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        await expect(
          historicCard.getByText(mode === "test" ? "Test node" : "Preview", { exact: true }),
        ).toBeVisible();
        await expect(
          historicCard.getByText(`Workflow revision ${original.workflow_revision}`, {
            exact: true,
          }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: testInfo.outputPath(`history-${mode}-${width}-${colorScheme}.png`),
        });
      }
    }
    await historicCard.focus();
    await page.keyboard.press("Enter");
    await page
      .locator('.svelte-flow__node[data-id="parse"]')
      .getByRole("button", { name: /^Audit parse / })
      .click();
    await checkOutput(1);
    await expect(output.getByText(warning, { exact: true })).toHaveCount(0);
    expect(await (await request.get(runURL, { headers })).json()).toEqual(original);
    const saved = await (
      await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
        headers,
      })
    ).json();
    expect(saved.enabled).toBe(false);
    expect(errors).toEqual([]);
  });
}
