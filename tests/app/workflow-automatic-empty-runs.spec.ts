import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

test("empty active schedule history explains timing without activating or running it", async ({
  page,
  request,
}, info) => {
  const auth = await registerUser(request, `timer-help-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Timer waiting help");
  const headers = { Authorization: `Bearer ${auth.token}` };
  const response = await request.post(`/api/v1/workflows?workspace_id=${workspace.id}`, {
    headers,
    data: {
      name: "Audit waiting schedule",
      description: "",
      expected_revision: 0,
      definition: {
        schema: 1,
        source: { kind: "interval", interval_minutes: 5 },
        steps: [
          {
            id: "fields",
            name: "Audit fields",
            kind: "set_fields",
            inputs: { fields: { literal: { audit: "safe fixture" } } },
          },
        ],
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const workflow = await response.json();
  const database = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
  // Seed a read-only active snapshot, not activation. A future baseline prevents timer admission.
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    database,
    `UPDATE workflows SET enabled=1,published_revision=revision,published_json=draft_json,source_started_at='2100-01-01T00:00:00Z',last_checked_at='2100-01-01T00:00:00Z' WHERE id='${workflow.id}';`,
  ]);
  try {
    await authenticatePage(page, auth.token);
    await page.goto(`/workflows/${workflow.id}`);
    for (const width of [1280, 390, 320])
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.reload();
        await page
          .locator("[data-workflow-editor] > header")
          .getByRole("button", { name: "Runs", exact: true })
          .click();
        await expect(
          page.getByText(
            "This schedule is active. Its first run starts after 5 minutes and the next background check.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByText("Preview a workflow to inspect its steps without making changes.", {
            exact: true,
          }),
        ).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`timer-${width}-${scheme}.png`) });
      }
    await page.goto("/workflows");
    await page.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(
      page.getByText("Runs appear here when an active workflow's published trigger fires.", {
        exact: true,
      }),
    ).toBeVisible();
    const changed = await request.put(
      `/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`,
      {
        headers,
        data: {
          name: workflow.name,
          description: "",
          expected_revision: workflow.revision,
          definition: {
            ...workflow.definition,
            source: { kind: "interval", interval_minutes: 30 },
          },
        },
      },
    );
    expect(changed.ok(), await changed.text()).toBe(true);
    const changedDraft = await changed.json();
    expect(changedDraft.published_revision).toBe(workflow.revision);
    expect(changedDraft.revision).toBeGreaterThan(changedDraft.published_revision);
    await page.goto(`/workflows/${workflow.id}`);
    await page
      .locator("[data-workflow-editor] > header")
      .getByRole("button", { name: "Runs", exact: true })
      .click();
    await expect(
      page.getByText("Runs appear here when an active workflow's published trigger fires.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/^This schedule is active\./)).toHaveCount(0);
    expect(
      await (
        await request.get(`/api/v1/workflow-runs?workspace_id=${workspace.id}`, { headers })
      ).json(),
    ).toEqual([]);
  } finally {
    execFileSync("sqlite3", [
      "-cmd",
      ".timeout 5000",
      database,
      `UPDATE workflows SET enabled=0 WHERE id='${workflow.id}';`,
    ]);
  }
  const restored = await (
    await request.get(`/api/v1/workflows/${workflow.id}?workspace_id=${workspace.id}`, { headers })
  ).json();
  expect(restored.enabled).toBe(false);
  await page.reload();
  await page
    .locator("[data-workflow-editor] > header")
    .getByRole("button", { name: "Runs", exact: true })
    .click();
  await expect(
    page.getByText("Preview a workflow to inspect its steps without making changes.", {
      exact: true,
    }),
  ).toBeVisible();
});
