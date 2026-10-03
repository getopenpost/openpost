import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

for (const concern of ["loop", "ports"] as const) {
  test(`workflow graph ${concern} preserves authored connections`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(60000);
    const auth = await registerUser(request, `graph-${randomUUID()}@example.com`);
    const workspace = await createWorkspace(request, auth.token, "Graph admission");
    const headers = { Authorization: `Bearer ${auth.token}` };
    const definition = {
      schema: 1,
      source: { kind: "manual" },
      steps: [
        {
          id: "condition",
          name: "Audit condition",
          kind: "condition",
          inputs: {
            left: { literal: "release" },
            operator: { literal: "contains" },
            right: { literal: "release" },
          },
          then: [
            {
              id: "yes",
              name: "Audit yes",
              kind: "parse_json",
              inputs: { text: { literal: "{}" } },
            },
          ],
          else: [
            { id: "no", name: "Audit no", kind: "parse_json", inputs: { text: { literal: "{}" } } },
          ],
        },
      ],
    };
    const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
      headers,
      data: { name: "Audit graph admission", description: "", expected_revision: 0, definition },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = await created.json();
    const path = `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await authenticatePage(page, auth.token);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/workflows/${workflow.id}`);
    await expect(page.getByRole("button", { name: /^Audit condition / })).toBeVisible();
    await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
    async function drag(source: string, target: string) {
      await expect
        .poll(() =>
          page.locator(".svelte-flow__viewport").evaluate(async (element) => {
            const before = element.style.transform;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return before === element.style.transform;
          }),
        )
        .toBe(true);
      for (const handle of [
        page.locator(`.svelte-flow__handle.source[data-nodeid="${source}"]`),
        page.locator(`.svelte-flow__handle.target[data-nodeid="${target}"]`),
      ]) {
        await expect
          .poll(() =>
            handle.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return (
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) ===
                element
              );
            }),
          )
          .toBe(true);
      }
      await page
        .locator(`.svelte-flow__handle.source[data-nodeid="${source}"]`)
        .dragTo(page.locator(`.svelte-flow__handle.target[data-nodeid="${target}"]`));
    }
    if (concern === "ports") {
      for (const width of [1280, 390, 320]) {
        for (const scheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
          for (const name of [
            "Audit condition: input",
            "Audit condition: Yes output",
            "Audit condition: No output",
            "Audit yes: output",
            "Run manually: output",
          ])
            await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Handle", exact: true })).toHaveCount(0);
          const node = page.getByRole("button", { name: /^Audit condition / });
          await node.focus();
          await page.keyboard.press("Enter");
          await expect(page.getByRole("textbox", { name: "Step name", exact: true })).toHaveValue(
            "Audit condition",
          );
          await page.getByRole("button", { name: "Back to canvas", exact: true }).focus();
          await page.keyboard.press("Enter");
          await expect(node).toBeFocused();
          await page.screenshot({ path: testInfo.outputPath(`ports-${width}-${scheme}.png`) });
        }
      }
    } else {
      await drag("yes", "condition");
      await expect(
        page.getByText(
          "This connection would create a loop. Connect to a step outside this branch.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Edge from yes to condition", exact: true }),
      ).toHaveCount(0);
      expect((await (await request.get(path, { headers })).json()).definition).toEqual(definition);
      for (const width of [1280, 390, 320]) {
        for (const scheme of ["light", "dark"] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
          await page.screenshot({ path: testInfo.outputPath(`warning-${width}-${scheme}.png`) });
          const warning = page
            .getByRole("status")
            .filter({ hasText: "This connection would create a loop." });
          await expect(warning).toBeVisible();
          await warning.getByRole("button", { name: "Close", exact: true }).focus();
          await page.keyboard.press("Enter");
          await expect(warning).toHaveCount(0);
          await drag("yes", "condition");
          await expect(warning).toBeVisible();
          await expect(page.getByRole("img", { name: /^Edge from/ })).toHaveCount(3);
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
      await drag("yes", "no");
      const { else: noSteps, ...condition } = definition.steps[0];
      const reparented = {
        ...definition,
        steps: [{ ...condition, then: [...condition.then, ...noSteps] }],
      };
      await expect
        .poll(async () => (await (await request.get(path, { headers })).json()).definition)
        .toEqual(reparented);
      await expect(
        page.getByText("This connection would create a loop.", { exact: false }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Undo", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await (await request.get(path, { headers })).json()).definition)
        .toEqual(definition);
      await page.reload();
      await expect(page.getByRole("button", { name: /^Audit condition / })).toBeVisible();
      await expect(
        page.getByRole("img", { name: "Edge from condition to no", exact: true }),
      ).toHaveCount(1);
      expect((await (await request.get(path, { headers })).json()).definition).toEqual(definition);
    }
    expect(errors).toEqual([]);
  });
}
