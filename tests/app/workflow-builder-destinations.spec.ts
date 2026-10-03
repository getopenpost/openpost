import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("Builder destinations show required guidance and recover without execution", async ({
  page,
  request,
}, info) => {
  test.setTimeout(60000);
  const auth = await registerUser(request, `builder-dest-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Builder destinations");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active) VALUES ('${accountID}','${workspace.id}','audit-${accountID}','bluesky','${accountID}','auditbuilder',X'00',1);`,
  ]);
  const headers = { Authorization: `Bearer ${auth.token}` };
  const created = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit Builder destinations",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "manual" },
        steps: [
          {
            id: "build",
            kind: "build_draft",
            name: "Audit Builder",
            inputs: {
              text: { literal: "Synthetic internal post" },
              account_ids: { literal: [] },
              social_set_id: { literal: "" },
            },
          },
        ],
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  await authenticatePage(page, auth.token);
  await page.goto(`/workflows/${workflow.id}`);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const node = page.locator('.svelte-flow__node[data-id="build"]');
      await node.getByRole("button", { name: /^Audit Builder / }).click();
      const guidance = page.getByText("Choose a Social Set or destination first.", { exact: true });
      if (width === 1280 && scheme === "light") await expect(guidance).toBeVisible();
      else {
        await page
          .getByRole("group", { name: "Destinations", exact: true })
          .getByRole("button", { name: /^Accounts:/ })
          .click();
        const account = page.getByRole("checkbox", { name: /auditbuilder/ });
        await account.uncheck();
        await page.keyboard.press("Escape");
        await expect(guidance).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`destinations-${width}-${scheme}.png`) });
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(node).toContainText("Needs attention");
      await node.getByRole("button", { name: /^Audit Builder / }).click();
      const picker = page
        .getByRole("group", { name: "Destinations", exact: true })
        .getByRole("button", { name: /^Accounts:/ });
      await picker.focus();
      await picker.press("Enter");
      const account = page.getByRole("checkbox", { name: /auditbuilder/ });
      await account.focus();
      await account.press("Space");
      await page.keyboard.press("Escape");
      await expect(guidance).toBeHidden();
      await page.getByRole("button", { name: "Back to canvas", exact: true }).click();
      await expect(node).not.toContainText("Needs attention");
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, {
                  headers,
                })
              ).json()
            ).definition.steps[0].inputs.account_ids.literal,
        )
        .toEqual([accountID]);
      await page.reload();
    }
  const saved = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(saved.enabled).toBe(false);
  expect(saved.published_revision).toBe(0);
  expect(
    await (
      await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
    ).json(),
  ).toEqual([]);
});
